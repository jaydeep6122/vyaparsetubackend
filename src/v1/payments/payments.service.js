import pool from "../../db/db.js";
import { Filters, insertRows, likePattern, pageResult, setClause } from "../../db/sql.js";
import { withTransaction } from "../../db/transaction.js";
import { audit } from "../../services/audit.js";
import { nextDocumentNumber } from "../../services/numbering.js";
import { postPayment } from "../../services/posting.js";
import { ApiError } from "../../utils/ApiError.js";
import { today } from "../../utils/fy.js";
import { dec, money, sum } from "../../utils/money.js";

// Money in settles what customers owe; money out settles what the business owes.
const SETTLES = { in: ["sale", "purchase_return"], out: ["purchase", "sale_return"] };

const PAYMENT_COLUMNS = [
  "payment_type",
  "payment_number",
  "payment_date",
  "party_id",
  "account_id",
  "mode",
  "amount",
  "reference_no",
  "cheque_no",
  "cheque_date",
  "notes",
];

async function validatePayment(client, businessId, data) {
  const {
    rows: [account],
  } = await client.query("SELECT archived_at FROM accounts WHERE id = $1 AND business_id = $2", [
    data.account_id,
    businessId,
  ]);
  if (!account) throw new ApiError(400, "Account not found");
  if (account.archived_at) throw new ApiError(400, "Account is archived");

  if (data.party_id) {
    const {
      rows: [party],
    } = await client.query("SELECT archived_at FROM parties WHERE id = $1 AND business_id = $2", [
      data.party_id,
      businessId,
    ]);
    if (!party) throw new ApiError(400, "Party not found");
    if (party.archived_at) throw new ApiError(400, "Party is archived");
  }

  if (data.mode !== "cheque" && (data.cheque_no || data.cheque_date)) {
    throw new ApiError(400, "Cheque details are only for cheque payments");
  }

  const allocated = sum((data.allocations ?? []).map((allocation) => allocation.amount));
  if (!data.party_id && !allocated.eq(dec(data.amount))) {
    throw new ApiError(400, "A payment without a party must be fully allocated to bills or expenses");
  }
}

function assertOutstanding(label, amount, total, settled) {
  const outstanding = dec(total).minus(settled);
  if (dec(amount).gt(outstanding)) {
    throw new ApiError(400, `${label} has only ${money(outstanding)} left to pay`);
  }
}

/** Checks every allocation against its document, then inserts them all. */
async function allocate(client, payment, allocations) {
  if (sum(allocations.map((allocation) => allocation.amount)).gt(payment.amount)) {
    throw new ApiError(400, "Allocations add up to more than the payment amount");
  }

  const samePartyAs = (partyId) => (partyId ?? null) === (payment.party_id ?? null);
  const targetId = (allocation) => allocation.invoice_id ?? allocation.invoice_charge_id ?? allocation.expense_id;
  const seen = new Set();

  // Documents are locked in id order so two payments on the same bills cannot deadlock.
  for (const allocation of [...allocations].sort((a, b) => targetId(a).localeCompare(targetId(b)))) {
    if (seen.has(targetId(allocation))) {
      throw new ApiError(400, "The same document appears twice in allocations");
    }
    seen.add(targetId(allocation));

    if (allocation.invoice_id) {
      const {
        rows: [invoice],
      } = await client.query(
        `SELECT invoice_type, invoice_number, party_id, status, total_amount, amount_settled
         FROM invoices WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [allocation.invoice_id, payment.business_id],
      );
      if (!invoice) throw new ApiError(400, "Invoice to settle was not found");
      const label = `Invoice ${invoice.invoice_number}`;
      if (invoice.status !== "final") throw new ApiError(400, `${label} is not final`);
      if (!SETTLES[payment.payment_type].includes(invoice.invoice_type)) {
        throw new ApiError(
          400,
          `A payment ${payment.payment_type} cannot settle a ${invoice.invoice_type.replace("_", " ")}`,
        );
      }
      if (!samePartyAs(invoice.party_id)) throw new ApiError(400, `${label} belongs to a different party`);
      assertOutstanding(label, allocation.amount, invoice.total_amount, invoice.amount_settled);
    } else if (allocation.invoice_charge_id) {
      const {
        rows: [charge],
      } = await client.query(
        `SELECT c.charge_type, c.payee_party_id, c.amount, c.tax_amount, c.amount_settled,
                i.invoice_number, i.status
         FROM invoice_charges c JOIN invoices i ON i.id = c.invoice_id
         WHERE c.id = $1 AND c.business_id = $2
         FOR UPDATE OF c`,
        [allocation.invoice_charge_id, payment.business_id],
      );
      if (!charge) throw new ApiError(400, "Charge to settle was not found");
      const label = `The ${charge.charge_type} charge on ${charge.invoice_number}`;
      if (charge.status !== "final") throw new ApiError(400, `${label} is on an invoice that is not final`);
      if (payment.payment_type !== "out") throw new ApiError(400, "Charges are settled with a payment out");
      if (!charge.payee_party_id || charge.payee_party_id !== payment.party_id) {
        throw new ApiError(400, `${label} is owed to a different party`);
      }
      assertOutstanding(label, allocation.amount, dec(charge.amount).plus(charge.tax_amount), charge.amount_settled);
    } else {
      const {
        rows: [expense],
      } = await client.query(
        `SELECT expense_number, party_id, status, total_amount, amount_settled
         FROM expenses WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [allocation.expense_id, payment.business_id],
      );
      if (!expense) throw new ApiError(400, "Expense to settle was not found");
      const label = `Expense ${expense.expense_number}`;
      if (expense.status !== "active") throw new ApiError(400, `${label} is cancelled`);
      if (payment.payment_type !== "out") throw new ApiError(400, "Expenses are settled with a payment out");
      if (!samePartyAs(expense.party_id)) throw new ApiError(400, `${label} belongs to a different party`);
      assertOutstanding(label, allocation.amount, expense.total_amount, expense.amount_settled);
    }
  }

  await insertRows(
    client,
    "payment_allocations",
    ["business_id", "payment_id", "invoice_id", "invoice_charge_id", "expense_id", "amount"],
    allocations.map((allocation) => ({ ...allocation, business_id: payment.business_id, payment_id: payment.id })),
  );
}

/**
 * Records a payment inside an existing transaction. Also used by invoices and
 * expenses for money paid at the time the document is created.
 */
export async function recordPayment(client, ctx, data) {
  await validatePayment(client, ctx.business.id, data);
  const paymentDate = data.payment_date ?? today();
  const allocations = data.allocations ?? [];

  const [payment] = await insertRows(
    client,
    "payments",
    ["business_id", ...PAYMENT_COLUMNS, "created_by"],
    [
      {
        ...data,
        business_id: ctx.business.id,
        payment_date: paymentDate,
        payment_number:
          data.payment_number ??
          (await nextDocumentNumber(client, ctx.business, `payment_${data.payment_type}`, paymentDate)),
        created_by: ctx.user.id,
      },
    ],
    "*",
  );

  await allocate(client, payment, allocations);
  await postPayment(client, payment.id);
  await audit(client, {
    businessId: ctx.business.id,
    userId: ctx.user.id,
    action: "create",
    entityType: "payment",
    entityId: payment.id,
    after: { ...payment, allocations },
  });
  return payment.id;
}

export async function getPayment(db, businessId, paymentId) {
  const {
    rows: [payment],
  } = await db.query(
    `SELECT p.*, pt.name AS party_name, a.name AS account_name
     FROM payments p
     LEFT JOIN parties pt ON pt.id = p.party_id
     JOIN accounts a ON a.id = p.account_id
     WHERE p.business_id = $1 AND p.id = $2`,
    [businessId, paymentId],
  );
  if (!payment) throw new ApiError(404, "Payment not found");

  const { rows: allocations } = await db.query(
    `SELECT pa.id, pa.invoice_id, pa.invoice_charge_id, pa.expense_id, pa.amount,
            COALESCE(i.invoice_number, ci.invoice_number, e.expense_number) AS document_number,
            COALESCE(i.invoice_date, ci.invoice_date, e.expense_date) AS document_date
     FROM payment_allocations pa
     LEFT JOIN invoices i ON i.id = pa.invoice_id
     LEFT JOIN invoice_charges c ON c.id = pa.invoice_charge_id
     LEFT JOIN invoices ci ON ci.id = c.invoice_id
     LEFT JOIN expenses e ON e.id = pa.expense_id
     WHERE pa.payment_id = $1
     ORDER BY document_date, document_number`,
    [paymentId],
  );
  return { ...payment, allocations };
}

export async function createPayment(ctx, data) {
  return withTransaction(async (client) => {
    const paymentId = await recordPayment(client, ctx, data);
    return getPayment(client, ctx.business.id, paymentId);
  });
}

async function lockPayment(client, businessId, paymentId) {
  const {
    rows: [payment],
  } = await client.query("SELECT * FROM payments WHERE id = $1 AND business_id = $2 FOR UPDATE", [
    paymentId,
    businessId,
  ]);
  if (!payment) throw new ApiError(404, "Payment not found");
  if (payment.status !== "active") throw new ApiError(400, "This payment is cancelled");
  return payment;
}

export async function updatePayment(ctx, paymentId, data) {
  return withTransaction(async (client) => {
    const before = await getPayment(client, ctx.business.id, paymentId);
    await lockPayment(client, ctx.business.id, paymentId);
    await validatePayment(client, ctx.business.id, data);

    // Allocations are replaced wholesale; the trigger resets the settled totals.
    await client.query("DELETE FROM payment_allocations WHERE payment_id = $1", [paymentId]);

    const fields = {
      payment_date: data.payment_date ?? before.payment_date,
      party_id: data.party_id ?? null,
      account_id: data.account_id,
      mode: data.mode,
      amount: data.amount,
      reference_no: data.reference_no ?? null,
      cheque_no: data.cheque_no ?? null,
      cheque_date: data.cheque_date ?? null,
      notes: data.notes ?? null,
    };
    const set = setClause(fields, Object.keys(fields));
    const {
      rows: [payment],
    } = await client.query(`UPDATE payments SET ${set.sql} WHERE id = $${set.keys.length + 1} RETURNING *`, [
      ...set.values,
      paymentId,
    ]);

    await allocate(client, payment, data.allocations ?? []);
    await postPayment(client, paymentId);

    const after = await getPayment(client, ctx.business.id, paymentId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "update",
      entityType: "payment",
      entityId: paymentId,
      before,
      after,
    });
    return after;
  });
}

/** Cancelling unlinks the payment from every bill and removes it from the books. */
export async function cancelPayment(ctx, paymentId, reason) {
  return withTransaction(async (client) => {
    await lockPayment(client, ctx.business.id, paymentId);
    await client.query("DELETE FROM payment_allocations WHERE payment_id = $1", [paymentId]);
    await client.query(
      "UPDATE payments SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2 WHERE id = $1",
      [paymentId, reason ?? null],
    );
    await postPayment(client, paymentId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "cancel",
      entityType: "payment",
      entityId: paymentId,
      after: { reason },
    });
    return getPayment(client, ctx.business.id, paymentId);
  });
}

export async function listPayments(ctx, query) {
  const filters = new Filters().add("p.business_id = ?", ctx.business.id);
  filters.addIf(query.payment_type, "p.payment_type = ?", query.payment_type);
  filters.addIf(query.party_id, "p.party_id = ?", query.party_id);
  filters.addIf(query.account_id, "p.account_id = ?", query.account_id);
  filters.addIf(query.mode, "p.mode = ?", query.mode);
  filters.addIf(query.status, "p.status = ?", query.status);
  filters.addIf(query.from, "p.payment_date >= ?", query.from);
  filters.addIf(query.to, "p.payment_date <= ?", query.to);
  filters.addIf(
    query.search,
    "(p.payment_number ILIKE ? OR p.reference_no ILIKE ? OR pt.name ILIKE ?)",
    query.search && likePattern(query.search),
  );

  const { rows } = await pool.query(
    `SELECT p.*, pt.name AS party_name, a.name AS account_name, COUNT(*) OVER () AS total_count
     FROM payments p
     LEFT JOIN parties pt ON pt.id = p.party_id
     JOIN accounts a ON a.id = p.account_id
     ${filters.where}
     ORDER BY p.payment_date DESC, p.created_at DESC
     LIMIT ${filters.param(query.limit)} OFFSET ${filters.param(query.offset)}`,
    filters.values,
  );
  return pageResult(rows, query);
}
