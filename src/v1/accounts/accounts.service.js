import pool from "../../db/db.js";
import { insertRows, setClause } from "../../db/sql.js";
import { withTransaction } from "../../db/transaction.js";
import { audit } from "../../services/audit.js";
import { postAccountOpening } from "../../services/posting.js";
import { ApiError } from "../../utils/ApiError.js";
import { today } from "../../utils/fy.js";

const EDITABLE_COLUMNS = ["name", "bank_name", "account_number", "ifsc", "upi_id", "is_default"];

const ACCOUNT_SELECT = `
  SELECT a.*,
         bal.balance,
         COALESCE(op.amount, 0)::numeric(15,2) AS opening_balance,
         op.entry_date AS opening_balance_date
  FROM accounts a
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(e.amount), 0)::numeric(15,2) AS balance
    FROM account_entries e
    WHERE e.business_id = a.business_id AND e.account_id = a.id
  ) bal
  LEFT JOIN account_entries op
    ON op.account_id = a.id AND op.source_type = 'opening' AND op.source_id = a.id`;

export async function getAccount(db, businessId, accountId) {
  const {
    rows: [account],
  } = await db.query(`${ACCOUNT_SELECT} WHERE a.business_id = $1 AND a.id = $2`, [businessId, accountId]);
  if (!account) throw new ApiError(404, "Account not found");
  return account;
}

export async function listAccounts(ctx, { include_archived }) {
  const { rows } = await pool.query(
    `${ACCOUNT_SELECT}
     WHERE a.business_id = $1 ${include_archived ? "" : "AND a.archived_at IS NULL"}
     ORDER BY a.account_type = 'bank', a.is_default DESC, lower(a.name)`,
    [ctx.business.id],
  );
  return rows;
}

async function clearDefault(client, businessId, accountType, exceptId) {
  await client.query(
    `UPDATE accounts SET is_default = false
     WHERE business_id = $1 AND account_type = $2 AND is_default AND id IS DISTINCT FROM $3`,
    [businessId, accountType, exceptId ?? null],
  );
}

export async function createAccount(ctx, data) {
  return withTransaction(async (client) => {
    if (data.is_default) await clearDefault(client, ctx.business.id, data.account_type);

    const [account] = await insertRows(
      client,
      "accounts",
      ["business_id", "account_type", ...EDITABLE_COLUMNS],
      [{ ...data, business_id: ctx.business.id, is_default: data.is_default ?? false }],
      "*",
    );
    await postAccountOpening(client, account, {
      amount: data.opening_balance,
      date: data.opening_balance_date ?? today(),
    });
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "create",
      entityType: "account",
      entityId: account.id,
      after: account,
    });
    return getAccount(client, ctx.business.id, account.id);
  });
}

export async function updateAccount(ctx, accountId, data) {
  return withTransaction(async (client) => {
    const before = await getAccount(client, ctx.business.id, accountId);
    if (data.is_default) await clearDefault(client, ctx.business.id, before.account_type, accountId);

    const set = setClause(data, EDITABLE_COLUMNS);
    if (set.keys.length > 0) {
      await client.query(
        `UPDATE accounts SET ${set.sql} WHERE id = $${set.keys.length + 1} AND business_id = $${set.keys.length + 2}`,
        [...set.values, accountId, ctx.business.id],
      );
    }

    if (data.opening_balance !== undefined || data.opening_balance_date !== undefined) {
      await postAccountOpening(client, before, {
        amount: data.opening_balance ?? before.opening_balance,
        date: data.opening_balance_date ?? before.opening_balance_date ?? today(),
      });
    }

    const after = await getAccount(client, ctx.business.id, accountId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "update",
      entityType: "account",
      entityId: accountId,
      before,
      after,
    });
    return after;
  });
}

export async function setAccountArchived(ctx, accountId, archived) {
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      archived
        ? "UPDATE accounts SET archived_at = now(), is_default = false WHERE id = $1 AND business_id = $2"
        : "UPDATE accounts SET archived_at = NULL WHERE id = $1 AND business_id = $2",
      [accountId, ctx.business.id],
    );
    if (!rowCount) throw new ApiError(404, "Account not found");

    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: archived ? "archive" : "restore",
      entityType: "account",
      entityId: accountId,
    });
    return getAccount(client, ctx.business.id, accountId);
  });
}
