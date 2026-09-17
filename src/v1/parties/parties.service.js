import pool from "../../db/db.js";
import { Filters, insertRows, likePattern, pageResult, setClause } from "../../db/sql.js";
import { withTransaction } from "../../db/transaction.js";
import { hasRole } from "../../middlewares/auth.middlewares.js";
import { audit } from "../../services/audit.js";
import { postPartyOpening } from "../../services/posting.js";
import { ApiError } from "../../utils/ApiError.js";
import { today } from "../../utils/fy.js";
import { dec, money } from "../../utils/money.js";

const PARTY_COLUMNS = [
  "name",
  "party_type",
  "phone",
  "email",
  "gst_type",
  "gstin",
  "state_code",
  "credit_limit",
  "credit_days",
  "notes",
];

const ADDRESS_KINDS = ["billing", "shipping"];

// balance > 0: the party owes the business (receivable); < 0: payable.
// Addresses come back defaults first, then in the order they were saved.
const PARTY_SELECT = `
  SELECT p.*,
         bal.balance,
         addr.addresses,
         op.debit AS opening_debit,
         op.credit AS opening_credit,
         op.entry_date AS opening_balance_date
  FROM parties p
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(e.debit - e.credit), 0)::numeric(15,2) AS balance
    FROM party_ledger_entries e
    WHERE e.business_id = p.business_id AND e.party_id = p.id
  ) bal
  CROSS JOIN LATERAL (
    SELECT COALESCE(
             json_agg(
               json_build_object('id', a.id, 'kind', a.kind, 'label', a.label,
                                 'address', a.address, 'is_default', a.is_default)
               ORDER BY a.kind, a.is_default DESC, a.position, a.created_at
             ),
             '[]'::json
           ) AS addresses
    FROM party_addresses a
    WHERE a.party_id = p.id
  ) addr
  LEFT JOIN party_ledger_entries op
    ON op.party_id = p.id AND op.source_type = 'opening' AND op.source_id = p.id`;

const defaultAddress = (addresses, kind) =>
  addresses.find((entry) => entry.kind === kind && entry.is_default)?.address ?? null;

function shape({ opening_debit, opening_credit, total_count, ...party }) {
  const credit = dec(opening_credit ?? 0);
  return {
    ...party,
    // Kept for clients that know one address of each kind: the defaults.
    billing_address: defaultAddress(party.addresses, "billing"),
    shipping_address: defaultAddress(party.addresses, "shipping"),
    opening_balance: money(dec(opening_debit ?? 0).plus(credit)),
    opening_balance_type: credit.gt(0) ? "payable" : "receivable",
    balance_type: dec(party.balance).lt(0) ? "payable" : "receivable",
    ...(total_count !== undefined && { total_count }),
  };
}

const isBlankAddress = (value) =>
  !Object.values(value ?? {}).some((field) => typeof field === "string" && field.trim() !== "");

/**
 * Makes the party's saved addresses exactly `entries`: listed ids are updated,
 * entries without an id are added, everything else is removed. Bills keep
 * their own copy of an address, so removing one never changes a bill.
 */
async function replaceAddresses(client, businessId, partyId, entries) {
  const { rows: existing } = await client.query(
    "SELECT id FROM party_addresses WHERE party_id = $1 AND business_id = $2",
    [partyId, businessId],
  );
  const existingIds = new Set(existing.map((row) => row.id));
  if (entries.some((entry) => entry.id && !existingIds.has(entry.id))) {
    throw new ApiError(400, "An address does not belong to this party");
  }

  const rows = entries.map((entry, position) => ({ ...entry, position, is_default: entry.is_default === true }));
  for (const kind of ADDRESS_KINDS) {
    const ofKind = rows.filter((row) => row.kind === kind);
    if (ofKind.length > 0 && !ofKind.some((row) => row.is_default)) ofKind[0].is_default = true;
  }

  await client.query(
    "DELETE FROM party_addresses WHERE party_id = $1 AND business_id = $2 AND NOT (id = ANY($3::uuid[]))",
    [partyId, businessId, rows.filter((row) => row.id).map((row) => row.id)],
  );
  // Clear defaults first so the one-default-per-kind index never sees two.
  await client.query("UPDATE party_addresses SET is_default = false WHERE party_id = $1 AND is_default", [partyId]);

  for (const row of rows) {
    if (row.id) {
      await client.query(
        `UPDATE party_addresses SET kind = $2, label = $3, address = $4, is_default = $5, position = $6
         WHERE id = $1`,
        [row.id, row.kind, row.label ?? null, row.address, row.is_default, row.position],
      );
    } else {
      await client.query(
        `INSERT INTO party_addresses (business_id, party_id, kind, label, address, is_default, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [businessId, partyId, row.kind, row.label ?? null, row.address, row.is_default, row.position],
      );
    }
  }
}

/**
 * An older client's single address of one kind. It sets that kind's default.
 * Clearing it only removes the address when the party has just that one, so
 * an old app saving the form cannot wipe addresses added from a newer one.
 */
async function applyLegacyAddress(client, businessId, partyId, kind, value) {
  if (value === undefined) return;

  const { rows: saved } = await client.query(
    "SELECT id, is_default FROM party_addresses WHERE party_id = $1 AND kind = $2 ORDER BY is_default DESC, position",
    [partyId, kind],
  );
  const current = saved.find((row) => row.is_default);

  if (value === null || isBlankAddress(value)) {
    if (saved.length === 1) await client.query("DELETE FROM party_addresses WHERE id = $1", [saved[0].id]);
    return;
  }
  if (current) {
    await client.query("UPDATE party_addresses SET address = $2 WHERE id = $1", [current.id, value]);
  } else {
    await client.query(
      `INSERT INTO party_addresses (business_id, party_id, kind, address, is_default, position)
       VALUES ($1, $2, $3, $4, true, $5)`,
      [businessId, partyId, kind, value, saved.length],
    );
  }
}

async function syncAddresses(client, businessId, partyId, data) {
  if (data.addresses !== undefined) {
    await replaceAddresses(client, businessId, partyId, data.addresses);
    return;
  }
  for (const kind of ADDRESS_KINDS) {
    await applyLegacyAddress(client, businessId, partyId, kind, data[`${kind}_address`]);
  }
}

export async function getParty(db, businessId, partyId) {
  const {
    rows: [party],
  } = await db.query(`${PARTY_SELECT} WHERE p.business_id = $1 AND p.id = $2`, [businessId, partyId]);
  if (!party) throw new ApiError(404, "Party not found");
  return shape(party);
}

export async function listParties(ctx, query) {
  const filters = new Filters().add("p.business_id = ?", ctx.business.id);
  filters.addIf(!query.include_archived, "p.archived_at IS NULL");
  if (query.party_type === "customer" || query.party_type === "supplier") {
    // 'both' parties show up in either list.
    filters.add("p.party_type IN (?, 'both')", query.party_type);
  } else {
    filters.addIf(query.party_type, "p.party_type = ?", query.party_type);
  }
  filters.addIf(query.search, "(p.name ILIKE ? OR p.phone ILIKE ?)", query.search && likePattern(query.search));

  const { rows } = await pool.query(
    `SELECT listed.*, COUNT(*) OVER () AS total_count
     FROM (${PARTY_SELECT} ${filters.where}) listed
     ORDER BY lower(listed.name)
     LIMIT ${filters.param(query.limit)} OFFSET ${filters.param(query.offset)}`,
    filters.values,
  );
  return pageResult(rows.map(shape), query);
}

function assertCanSetOpening(ctx, data) {
  const touchesOpening =
    data.opening_balance !== undefined || data.opening_balance_type !== undefined || data.opening_balance_date !== undefined;
  if (touchesOpening && !hasRole(ctx.role, "accountant")) {
    throw new ApiError(403, "Changing opening balances needs the accountant role or higher");
  }
}

export async function createParty(ctx, data) {
  assertCanSetOpening(ctx, data);

  return withTransaction(async (client) => {
    const [party] = await insertRows(
      client,
      "parties",
      ["business_id", ...PARTY_COLUMNS],
      [
        {
          ...data,
          business_id: ctx.business.id,
          gst_type: data.gst_type ?? (data.gstin ? "registered" : "unregistered"),
          state_code: data.state_code ?? data.gstin?.slice(0, 2) ?? null,
        },
      ],
      "*",
    );
    await syncAddresses(client, ctx.business.id, party.id, data);

    await postPartyOpening(client, party, {
      amount: data.opening_balance,
      type: data.opening_balance_type,
      date: data.opening_balance_date ?? today(),
    });
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "create",
      entityType: "party",
      entityId: party.id,
      after: party,
    });
    return getParty(client, ctx.business.id, party.id);
  });
}

export async function updateParty(ctx, partyId, data) {
  assertCanSetOpening(ctx, data);

  return withTransaction(async (client) => {
    const before = await getParty(client, ctx.business.id, partyId);
    const fields = { ...data };
    if (data.gstin && data.state_code === undefined) fields.state_code = data.gstin.slice(0, 2);

    const set = setClause(fields, PARTY_COLUMNS);
    if (set.keys.length > 0) {
      await client.query(
        `UPDATE parties SET ${set.sql} WHERE id = $${set.keys.length + 1} AND business_id = $${set.keys.length + 2}`,
        [...set.values, partyId, ctx.business.id],
      );
    }
    await syncAddresses(client, ctx.business.id, partyId, data);

    if (
      data.opening_balance !== undefined ||
      data.opening_balance_type !== undefined ||
      data.opening_balance_date !== undefined
    ) {
      await postPartyOpening(
        client,
        { id: partyId, business_id: ctx.business.id },
        {
          amount: data.opening_balance ?? before.opening_balance,
          type: data.opening_balance_type ?? before.opening_balance_type,
          date: data.opening_balance_date ?? before.opening_balance_date ?? today(),
        },
      );
    }

    const after = await getParty(client, ctx.business.id, partyId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "update",
      entityType: "party",
      entityId: partyId,
      before,
      after,
    });
    return after;
  });
}

export async function setPartyArchived(ctx, partyId, archived) {
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE parties SET archived_at = ${archived ? "now()" : "NULL"} WHERE id = $1 AND business_id = $2`,
      [partyId, ctx.business.id],
    );
    if (!rowCount) throw new ApiError(404, "Party not found");

    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: archived ? "archive" : "restore",
      entityType: "party",
      entityId: partyId,
    });
    return getParty(client, ctx.business.id, partyId);
  });
}
