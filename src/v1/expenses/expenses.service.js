import pool from "../../db/db.js";
import { Filters, insertRows, likePattern, pageResult, setClause } from "../../db/sql.js";
import { withTransaction } from "../../db/transaction.js";
import { audit } from "../../services/audit.js";
import { nextDocumentNumber } from "../../services/numbering.js";
import { postExpense } from "../../services/posting.js";
import { ApiError } from "../../utils/ApiError.js";
import { today } from "../../utils/fy.js";
import { dec, money, sum } from "../../utils/money.js";
import { recordPayment } from "../payments/payments.service.js";

const TAX_FIELDS = ["cgst_amount", "sgst_amount", "igst_amount", "cess_amount"];
const EXPENSE_COLUMNS = [
  "expense_number",
  "expense_date",
  "category_id",
  "party_id",
  "tax_mode",
  "taxable_amount",
  ...TAX_FIELDS,
  "itc_eligible",
  "total_amount",
  "notes",
];

async function prepareExpense(client, ctx, data, existing) {
  const taxMode = data.tax_mode ?? existing?.tax_mode ?? "non_gst";
  const taxes = Object.fromEntries(TAX_FIELDS.map((field) => [field, data[field] ?? "0"]));

  if (taxMode === "gst" && ctx.business.gst_registration_type !== "regular") {
    throw new ApiError(400, "Only a regular GST-registered business can record GST on expenses");
  }
  if (taxMode === "non_gst" && (Object.values(taxes).some((value) => dec(value).gt(0)) || data.itc_eligible)) {
    throw new ApiError(400, "A non-GST expense cannot carry tax amounts or input tax credit");
  }

  if (data.party_id) {
    const {
      rows: [party],
    } = await client.query("SELECT archived_at FROM parties WHERE id = $1 AND business_id = $2", [
      data.party_id,
      ctx.business.id,
    ]);
    if (!party) throw new ApiError(400, "Party not found");
    if (party.archived_at && data.party_id !== existing?.party_id) throw new ApiError(400, "Party is archived");
  }

  return {
    expense_date: data.expense_date ?? existing?.expense_date ?? today(),
    category_id: data.category_id ?? null,
    party_id: data.party_id ?? null,
    tax_mode: taxMode,
    taxable_amount: data.taxable_amount,
    ...taxes,
    itc_eligible: taxMode === "gst" ? (data.itc_eligible ?? false) : false,
    total_amount: money(sum([data.taxable_amount, ...Object.values(taxes)])),
    notes: data.notes ?? null,
  };
}

export async function getExpense(db, businessId, expenseId) {
  const {
    rows: [expense],
  } = await db.query(
    `SELECT e.*, c.name AS category_name, p.name AS party_name,
            (e.total_amount - e.amount_settled)::numeric(15,2) AS outstanding
     FROM expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN parties p ON p.id = e.party_id
     WHERE e.business_id = $1 AND e.id = $2`,
    [businessId, expenseId],
  );
  if (!expense) throw new ApiError(404, "Expense not found");

  const { rows: payments } = await db.query(
    `SELECT pa.id AS allocation_id, pa.amount, p.id AS payment_id, p.payment_number, p.payment_date, p.mode
     FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
     WHERE pa.expense_id = $1
     ORDER BY p.payment_date, p.payment_number`,
    [expenseId],
  );
  return { ...expense, payments };
}

export async function createExpense(ctx, data) {
  return withTransaction(async (client) => {
    const fields = await prepareExpense(client, ctx, data, null);
    if (!fields.party_id && !(data.payment && dec(data.payment.amount).eq(fields.total_amount))) {
      throw new ApiError(400, "An expense without a vendor must be paid in full right away");
    }

    fields.expense_number =
      data.expense_number ?? (await nextDocumentNumber(client, ctx.business, "expense", fields.expense_date));
    const [{ id: expenseId }] = await insertRows(
      client,
      "expenses",
      ["business_id", "created_by", ...EXPENSE_COLUMNS],
      [{ ...fields, business_id: ctx.business.id, created_by: ctx.user.id }],
      "id",
    );
    await postExpense(client, expenseId);

    if (data.payment) {
      await recordPayment(client, ctx, {
        ...data.payment,
        payment_type: "out",
        payment_date: fields.expense_date,
        party_id: fields.party_id,
        allocations: [{ expense_id: expenseId, amount: data.payment.amount }],
      });
    }

    const expense = await getExpense(client, ctx.business.id, expenseId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "create",
      entityType: "expense",
      entityId: expenseId,
      after: expense,
    });
    return expense;
  });
}

async function lockExpense(client, businessId, expenseId) {
  const {
    rows: [expense],
  } = await client.query("SELECT * FROM expenses WHERE id = $1 AND business_id = $2 FOR UPDATE", [
    expenseId,
    businessId,
  ]);
  if (!expense) throw new ApiError(404, "Expense not found");
  if (expense.status !== "active") throw new ApiError(400, "This expense is cancelled");
  return expense;
}

export async function updateExpense(ctx, expenseId, data) {
  return withTransaction(async (client) => {
    const existing = await lockExpense(client, ctx.business.id, expenseId);
    const before = await getExpense(client, ctx.business.id, expenseId);
    const fields = await prepareExpense(client, ctx, data, existing);

    const settled = dec(existing.amount_settled);
    if (settled.gt(0) && fields.party_id !== existing.party_id) {
      throw new ApiError(400, "Cancel the payments against this expense before changing its vendor");
    }
    if (settled.gt(fields.total_amount)) {
      throw new ApiError(400, `The new total is less than the ${money(settled)} already paid`);
    }
    fields.expense_number = data.expense_number ?? existing.expense_number;

    const set = setClause(fields, EXPENSE_COLUMNS);
    await client.query(`UPDATE expenses SET ${set.sql} WHERE id = $${set.keys.length + 1}`, [...set.values, expenseId]);
    await postExpense(client, expenseId);

    const after = await getExpense(client, ctx.business.id, expenseId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "update",
      entityType: "expense",
      entityId: expenseId,
      before,
      after,
    });
    return after;
  });
}

export async function cancelExpense(ctx, expenseId, reason) {
  return withTransaction(async (client) => {
    const expense = await lockExpense(client, ctx.business.id, expenseId);
    if (dec(expense.amount_settled).gt(0)) {
      throw new ApiError(409, "Cancel the payments against this expense first");
    }
    await client.query(
      "UPDATE expenses SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2 WHERE id = $1",
      [expenseId, reason ?? null],
    );
    await postExpense(client, expenseId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "cancel",
      entityType: "expense",
      entityId: expenseId,
      after: { reason },
    });
    return getExpense(client, ctx.business.id, expenseId);
  });
}

export async function listExpenses(ctx, query) {
  const filters = new Filters().add("e.business_id = ?", ctx.business.id);
  filters.addIf(query.category_id, "e.category_id = ?", query.category_id);
  filters.addIf(query.party_id, "e.party_id = ?", query.party_id);
  filters.addIf(query.status, "e.status = ?", query.status);
  filters.addIf(query.payment_status, "e.payment_status = ?", query.payment_status);
  filters.addIf(query.from, "e.expense_date >= ?", query.from);
  filters.addIf(query.to, "e.expense_date <= ?", query.to);
  filters.addIf(
    query.search,
    "(e.expense_number ILIKE ? OR e.notes ILIKE ? OR p.name ILIKE ?)",
    query.search && likePattern(query.search),
  );

  const { rows } = await pool.query(
    `SELECT e.*, c.name AS category_name, p.name AS party_name,
            (e.total_amount - e.amount_settled)::numeric(15,2) AS outstanding,
            COUNT(*) OVER () AS total_count
     FROM expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN parties p ON p.id = e.party_id
     ${filters.where}
     ORDER BY e.expense_date DESC, e.created_at DESC
     LIMIT ${filters.param(query.limit)} OFFSET ${filters.param(query.offset)}`,
    filters.values,
  );
  return pageResult(rows, query);
}
