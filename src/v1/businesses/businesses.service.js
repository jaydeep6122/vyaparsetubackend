import { createHash, randomBytes } from "node:crypto";
import pool from "../../db/db.js";
import { insertRows, setClause } from "../../db/sql.js";
import { withTransaction } from "../../db/transaction.js";
import { ROLE_RANK } from "../../middlewares/auth.middlewares.js";
import { audit } from "../../services/audit.js";
import { postAccountOpening } from "../../services/posting.js";
import { ApiError } from "../../utils/ApiError.js";
import { today } from "../../utils/fy.js";

// GST slabs in use after the September 2025 rate rationalisation, plus the
// older slabs still needed for some goods. Rates are data, not code, so a
// business can add or deactivate them.
const DEFAULT_TAX_RATES = ["0", "0.25", "3", "5", "12", "18", "28", "40"];
const DEFAULT_EXPENSE_CATEGORIES = [
  "Rent",
  "Salary",
  "Electricity",
  "Transport",
  "Office supplies",
  "Repairs",
  "Other",
];

const BUSINESS_COLUMNS = [
  "name",
  "legal_name",
  "gst_registration_type",
  "gstin",
  "pan",
  "state_code",
  "address",
  "phone",
  "email",
  "logo_url",
  "signature_url",
  "fy_start_month",
];

const INVITE_DAYS = 7;
const hashInviteToken = (token) => createHash("sha256").update(token).digest("hex");

export async function createBusiness(user, data) {
  return withTransaction(async (client) => {
    const [business] = await insertRows(
      client,
      "businesses",
      [...BUSINESS_COLUMNS, "settings", "created_by"],
      [
        {
          ...data,
          gst_registration_type: data.gst_registration_type ?? "unregistered",
          address: data.address ?? {},
          fy_start_month: data.fy_start_month ?? 4,
          settings: { round_off_invoices: true, ...data.settings },
          created_by: user.id,
        },
      ],
      "*",
    );

    await client.query(
      "INSERT INTO business_members (business_id, user_id, role) VALUES ($1, $2, 'owner')",
      [business.id, user.id],
    );

    const openingDate = today();
    const [cash] = await insertRows(
      client,
      "accounts",
      ["business_id", "name", "account_type", "is_default"],
      [{ business_id: business.id, name: "Cash in hand", account_type: "cash", is_default: true }],
      "*",
    );
    await postAccountOpening(client, cash, { amount: data.opening_cash_balance, date: openingDate });

    if (data.bank_account) {
      const { opening_balance, ...bank } = data.bank_account;
      const [account] = await insertRows(
        client,
        "accounts",
        ["business_id", "name", "account_type", "bank_name", "account_number", "ifsc", "upi_id", "is_default"],
        [{ ...bank, business_id: business.id, account_type: "bank", is_default: true }],
        "*",
      );
      await postAccountOpening(client, account, { amount: opening_balance, date: openingDate });
    }

    await insertRows(
      client,
      "tax_rates",
      ["business_id", "name", "rate"],
      DEFAULT_TAX_RATES.map((rate) => ({ business_id: business.id, name: `GST ${rate}%`, rate })),
    );
    await insertRows(
      client,
      "expense_categories",
      ["business_id", "name"],
      DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ business_id: business.id, name })),
    );

    await audit(client, {
      businessId: business.id,
      userId: user.id,
      action: "create",
      entityType: "business",
      entityId: business.id,
      after: business,
    });
    return { ...business, role: "owner" };
  });
}

export async function listBusinesses(userId) {
  const { rows } = await pool.query(
    `SELECT b.*, m.role
     FROM businesses b
     JOIN business_members m ON m.business_id = b.id
     WHERE m.user_id = $1 AND m.status = 'active' AND b.archived_at IS NULL
     ORDER BY b.created_at`,
    [userId],
  );
  return rows;
}

export async function updateBusiness(ctx, data) {
  const { settings, ...fields } = data;

  return withTransaction(async (client) => {
    const set = setClause(fields, BUSINESS_COLUMNS);
    const assignments = set.keys.length ? [set.sql] : [];
    const values = [...set.values];

    if (settings) {
      values.push(settings);
      assignments.push(`settings = settings || $${values.length}::jsonb`);
    }
    if (assignments.length === 0) return { ...ctx.business, role: ctx.role };

    values.push(ctx.business.id);
    const {
      rows: [business],
    } = await client.query(
      `UPDATE businesses SET ${assignments.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values,
    );

    await audit(client, {
      businessId: business.id,
      userId: ctx.user.id,
      action: "update",
      entityType: "business",
      entityId: business.id,
      before: ctx.business,
      after: business,
    });
    return { ...business, role: ctx.role };
  });
}

/** Businesses are archived, never deleted: their books must stay intact. */
export async function archiveBusiness(ctx) {
  await withTransaction(async (client) => {
    await client.query("UPDATE businesses SET archived_at = now() WHERE id = $1", [ctx.business.id]);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "archive",
      entityType: "business",
      entityId: ctx.business.id,
    });
  });
}

// ---- Members & invites ------------------------------------------------------

/** A manager may only act on roles strictly below their own (the owner may grant admin). */
function assertCanManage(ctx, targetRole, newRole) {
  if (targetRole === "owner") throw new ApiError(403, "The owner's membership cannot be changed");
  const rank = ROLE_RANK[ctx.role];
  const outranksTarget = targetRole === undefined || rank > ROLE_RANK[targetRole];
  const canGrant = newRole === undefined || ctx.role === "owner" || rank > ROLE_RANK[newRole];
  if (!outranksTarget || !canGrant) {
    throw new ApiError(403, "You can only manage members with a lower role than yours");
  }
}

export async function listMembers(ctx) {
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.name, u.email, m.role, m.created_at AS joined_at
     FROM business_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.business_id = $1 AND m.status = 'active'
     ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'accountant' THEN 3 ELSE 4 END, u.name`,
    [ctx.business.id],
  );
  return rows;
}

export async function createInvite(ctx, { email, role }) {
  assertCanManage(ctx, undefined, role);

  return withTransaction(async (client) => {
    const { rowCount: alreadyMember } = await client.query(
      `SELECT 1 FROM business_members m JOIN users u ON u.id = m.user_id
       WHERE m.business_id = $1 AND u.email = $2 AND m.status = 'active'`,
      [ctx.business.id, email],
    );
    if (alreadyMember) throw new ApiError(409, "This person is already a member of the business");

    // One open invite per email: a new invite replaces the previous one.
    await client.query(
      `UPDATE business_invites SET revoked_at = now()
       WHERE business_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [ctx.business.id, email],
    );

    const token = randomBytes(24).toString("base64url");
    const {
      rows: [invite],
    } = await client.query(
      `INSERT INTO business_invites (business_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
       RETURNING id, email, role, expires_at, created_at`,
      [ctx.business.id, email, role, hashInviteToken(token), ctx.user.id, INVITE_DAYS],
    );

    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "invite",
      entityType: "business_invite",
      entityId: invite.id,
      after: { email, role },
    });
    // The token is shown once, for sharing (e.g. over WhatsApp); only its hash is kept.
    return { ...invite, invite_token: token };
  });
}

export async function listInvites(ctx) {
  const { rows } = await pool.query(
    `SELECT id, email, role, expires_at, created_at
     FROM business_invites
     WHERE business_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC`,
    [ctx.business.id],
  );
  return rows;
}

export async function revokeInvite(ctx, inviteId) {
  const { rowCount } = await pool.query(
    `UPDATE business_invites SET revoked_at = now()
     WHERE id = $1 AND business_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [inviteId, ctx.business.id],
  );
  if (!rowCount) throw new ApiError(404, "Invite not found");
}

export async function acceptInvite(user, token) {
  return withTransaction(async (client) => {
    const {
      rows: [invite],
    } = await client.query(
      `SELECT i.*, b.archived_at
       FROM business_invites i JOIN businesses b ON b.id = i.business_id
       WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
       FOR UPDATE OF i`,
      [hashInviteToken(token)],
    );
    if (!invite || invite.archived_at) throw new ApiError(404, "Invite not found");
    if (new Date(invite.expires_at) <= new Date()) throw new ApiError(400, "This invite has expired");
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ApiError(403, "This invite was sent to a different email address");
    }

    const {
      rows: [membership],
    } = await client.query(
      `INSERT INTO business_members (business_id, user_id, role, invited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (business_id, user_id)
       DO UPDATE SET role = EXCLUDED.role, status = 'active', invited_by = EXCLUDED.invited_by
       WHERE business_members.status <> 'active'
       RETURNING role`,
      [invite.business_id, user.id, invite.role, invite.invited_by],
    );
    if (!membership) throw new ApiError(409, "You are already a member of this business");

    await client.query("UPDATE business_invites SET accepted_at = now() WHERE id = $1", [invite.id]);
    await audit(client, {
      businessId: invite.business_id,
      userId: user.id,
      action: "accept_invite",
      entityType: "business_invite",
      entityId: invite.id,
    });

    const {
      rows: [business],
    } = await client.query("SELECT * FROM businesses WHERE id = $1", [invite.business_id]);
    return { ...business, role: membership.role };
  });
}

async function activeMembership(client, businessId, userId) {
  const {
    rows: [member],
  } = await client.query(
    `SELECT role FROM business_members
     WHERE business_id = $1 AND user_id = $2 AND status = 'active'
     FOR UPDATE`,
    [businessId, userId],
  );
  if (!member) throw new ApiError(404, "Member not found");
  return member;
}

export async function changeMemberRole(ctx, userId, role) {
  return withTransaction(async (client) => {
    const member = await activeMembership(client, ctx.business.id, userId);
    assertCanManage(ctx, member.role, role);

    await client.query(
      "UPDATE business_members SET role = $1 WHERE business_id = $2 AND user_id = $3",
      [role, ctx.business.id, userId],
    );
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "change_role",
      entityType: "business_member",
      entityId: userId,
      before: { role: member.role },
      after: { role },
    });
    return { user_id: userId, role };
  });
}

/** Members can leave on their own; removing someone else needs a higher role. */
export async function removeMember(ctx, userId) {
  await withTransaction(async (client) => {
    const member = await activeMembership(client, ctx.business.id, userId);
    if (userId === ctx.user.id) {
      if (member.role === "owner") throw new ApiError(400, "The owner cannot leave the business");
    } else {
      assertCanManage(ctx, member.role);
    }

    await client.query(
      "UPDATE business_members SET status = 'removed' WHERE business_id = $1 AND user_id = $2",
      [ctx.business.id, userId],
    );
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "remove_member",
      entityType: "business_member",
      entityId: userId,
    });
  });
}

// ---- Document number series -----------------------------------------------

export async function listSeries(ctx) {
  const { rows } = await pool.query(
    `SELECT id, doc_type, financial_year, prefix, next_number, padding
     FROM document_series WHERE business_id = $1
     ORDER BY financial_year DESC, doc_type`,
    [ctx.business.id],
  );
  return rows;
}

export async function updateSeries(ctx, seriesId, data) {
  const set = setClause(data, ["prefix", "next_number", "padding"]);
  if (set.keys.length === 0) throw new ApiError(400, "Nothing to update");

  const {
    rows: [series],
  } = await pool.query(
    `UPDATE document_series SET ${set.sql}
     WHERE id = $${set.keys.length + 1} AND business_id = $${set.keys.length + 2}
     RETURNING id, doc_type, financial_year, prefix, next_number, padding`,
    [...set.values, seriesId, ctx.business.id],
  );
  if (!series) throw new ApiError(404, "Series not found");
  return series;
}
