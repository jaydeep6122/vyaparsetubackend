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
  "billing_address",
  "shipping_address",
  "credit_limit",
  "credit_days",
  "notes",
];

// balance > 0: the party owes the business (receivable); < 0: payable.
const PARTY_SELECT = `
  SELECT p.*,
         bal.balance,
         op.debit AS opening_debit,
         op.credit AS opening_credit,
         op.entry_date AS opening_balance_date
  FROM parties p
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(e.debit - e.credit), 0)::numeric(15,2) AS balance
    FROM party_ledger_entries e
    WHERE e.business_id = p.business_id AND e.party_id = p.id
  ) bal
  LEFT JOIN party_ledger_entries op
    ON op.party_id = p.id AND op.source_type = 'opening' AND op.source_id = p.id`;

function shape({ opening_debit, opening_credit, total_count, ...party }) {
  const credit = dec(opening_credit ?? 0);
  return {
    ...party,
    opening_balance: money(dec(opening_debit ?? 0).plus(credit)),
    opening_balance_type: credit.gt(0) ? "payable" : "receivable",
    balance_type: dec(party.balance).lt(0) ? "payable" : "receivable",
    ...(total_count !== undefined && { total_count }),
  };
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
