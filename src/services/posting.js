import { dec, money, rate } from "../utils/money.js";

/**
 * The only code that writes the ledgers. Every post* function deletes the
 * rows a source document produced and writes them again from its current
 * state, so create, edit and cancel all go through the same path and a
 * ledger can never disagree with its documents. Call inside the document's
 * transaction.
 *
 * Party ledger sides: debit = the party owes the business more,
 * credit = the business owes the party more.
 */

const PARTY_SIDE = {
  sale: "debit",
  purchase_return: "debit",
  purchase: "credit",
  sale_return: "credit",
};

const STOCK_DIRECTION = { sale: -1, purchase_return: -1, purchase: 1, sale_return: 1 };

const INVOICE_LABEL = {
  sale: "Sale",
  purchase: "Purchase",
  sale_return: "Sale return",
  purchase_return: "Purchase return",
};

async function clear(client, table, sourceTypes, sourceId) {
  await client.query(
    `DELETE FROM ${table} WHERE source_id = $1 AND source_type = ANY($2::text[])`,
    [sourceId, sourceTypes],
  );
}

async function partyEntry(client, { businessId, partyId, date, sourceType, sourceId, side, amount, narration }) {
  if (dec(amount).isZero()) return;
  await client.query(
    `INSERT INTO party_ledger_entries
       (business_id, party_id, entry_date, source_type, source_id, debit, credit, narration)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      businessId,
      partyId,
      date,
      sourceType,
      sourceId,
      side === "debit" ? money(amount) : "0",
      side === "credit" ? money(amount) : "0",
      narration,
    ],
  );
}

async function accountEntry(client, { businessId, accountId, date, sourceType, sourceId, amount, narration }) {
  if (dec(amount).isZero()) return;
  await client.query(
    `INSERT INTO account_entries (business_id, account_id, entry_date, amount, source_type, source_id, narration)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [businessId, accountId, date, money(amount), sourceType, sourceId, narration],
  );
}

async function stockMovement(client, { businessId, itemId, date, quantity, unitCost, sourceType, sourceId, sourceLineId }) {
  if (dec(quantity).isZero()) return;
  await client.query(
    `INSERT INTO stock_movements
       (business_id, item_id, movement_date, quantity, unit_cost, source_type, source_id, source_line_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [businessId, itemId, date, dec(quantity).toFixed(3), unitCost ?? null, sourceType, sourceId, sourceLineId ?? null],
  );
}

export async function postInvoice(client, invoiceId) {
  await clear(client, "party_ledger_entries", ["invoice", "invoice_charge"], invoiceId);
  await clear(client, "stock_movements", ["invoice"], invoiceId);

  const {
    rows: [invoice],
  } = await client.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
  if (invoice.status !== "final") return;

  const base = { businessId: invoice.business_id, date: invoice.invoice_date, sourceId: invoiceId };
  const label = `${INVOICE_LABEL[invoice.invoice_type]} ${invoice.invoice_number}`;

  if (invoice.party_id) {
    await partyEntry(client, {
      ...base,
      partyId: invoice.party_id,
      sourceType: "invoice",
      side: PARTY_SIDE[invoice.invoice_type],
      amount: invoice.total_amount,
      narration: label,
    });
  }

  // A charge with a payee (e.g. a transporter) is owed to that payee.
  const { rows: charges } = await client.query(
    "SELECT * FROM invoice_charges WHERE invoice_id = $1 AND payee_party_id IS NOT NULL",
    [invoiceId],
  );
  for (const charge of charges) {
    const vehicle = charge.vehicle_no || invoice.vehicle_no;
    await partyEntry(client, {
      ...base,
      partyId: charge.payee_party_id,
      sourceType: "invoice_charge",
      side: "credit",
      amount: dec(charge.amount).plus(charge.tax_amount),
      narration: `${charge.charge_type} on ${label}${vehicle ? ` (${vehicle})` : ""}`,
    });
  }

  const { rows: lines } = await client.query(
    `SELECT l.id, l.item_id, l.quantity, l.taxable_value
     FROM invoice_lines l
     JOIN items i ON i.id = l.item_id
     WHERE l.invoice_id = $1 AND i.track_stock`,
    [invoiceId],
  );
  for (const line of lines) {
    await stockMovement(client, {
      businessId: invoice.business_id,
      itemId: line.item_id,
      date: invoice.invoice_date,
      quantity: dec(line.quantity).times(STOCK_DIRECTION[invoice.invoice_type]),
      // Purchases set the cost basis (excluding GST) for stock valuation.
      unitCost:
        invoice.invoice_type === "purchase"
          ? rate(dec(line.taxable_value).dividedBy(line.quantity))
          : null,
      sourceType: "invoice",
      sourceId: invoiceId,
      sourceLineId: line.id,
    });
  }
}

export async function postPayment(client, paymentId) {
  await clear(client, "party_ledger_entries", ["payment"], paymentId);
  await clear(client, "account_entries", ["payment"], paymentId);

  const {
    rows: [payment],
  } = await client.query("SELECT * FROM payments WHERE id = $1", [paymentId]);
  if (payment.status !== "active") return;

  const isIn = payment.payment_type === "in";
  const narration = `${isIn ? "Receipt" : "Payment"} ${payment.payment_number}`;
  const base = { businessId: payment.business_id, date: payment.payment_date, sourceType: "payment", sourceId: paymentId, narration };

  if (payment.party_id) {
    await partyEntry(client, {
      ...base,
      partyId: payment.party_id,
      side: isIn ? "credit" : "debit",
      amount: payment.amount,
    });
  }
  await accountEntry(client, {
    ...base,
    accountId: payment.account_id,
    amount: isIn ? dec(payment.amount) : dec(payment.amount).negated(),
  });
}

export async function postExpense(client, expenseId) {
  await clear(client, "party_ledger_entries", ["expense"], expenseId);

  const {
    rows: [expense],
  } = await client.query("SELECT * FROM expenses WHERE id = $1", [expenseId]);
  if (expense.status !== "active" || !expense.party_id) return;

  await partyEntry(client, {
    businessId: expense.business_id,
    partyId: expense.party_id,
    date: expense.expense_date,
    sourceType: "expense",
    sourceId: expenseId,
    side: "credit",
    amount: expense.total_amount,
    narration: `Expense ${expense.expense_number}`,
  });
}

export async function postTransfer(client, transferId) {
  await clear(client, "account_entries", ["transfer"], transferId);

  const {
    rows: [transfer],
  } = await client.query("SELECT * FROM account_transfers WHERE id = $1", [transferId]);
  if (transfer.status !== "active") return;

  const base = { businessId: transfer.business_id, date: transfer.transfer_date, sourceType: "transfer", sourceId: transferId };
  await accountEntry(client, { ...base, accountId: transfer.from_account_id, amount: dec(transfer.amount).negated(), narration: "Transfer out" });
  await accountEntry(client, { ...base, accountId: transfer.to_account_id, amount: transfer.amount, narration: "Transfer in" });
}

export async function postStockAdjustment(client, adjustmentId) {
  await clear(client, "stock_movements", ["adjustment"], adjustmentId);

  const {
    rows: [adjustment],
  } = await client.query("SELECT * FROM stock_adjustments WHERE id = $1", [adjustmentId]);
  if (adjustment.status !== "active") return;

  const { rows: lines } = await client.query(
    "SELECT * FROM stock_adjustment_lines WHERE adjustment_id = $1",
    [adjustmentId],
  );
  for (const line of lines) {
    await stockMovement(client, {
      businessId: adjustment.business_id,
      itemId: line.item_id,
      date: adjustment.adjustment_date,
      quantity: line.quantity,
      unitCost: line.unit_cost,
      sourceType: "adjustment",
      sourceId: adjustmentId,
      sourceLineId: line.id,
    });
  }
}

/** `type` 'receivable' = the party owes the business; 'payable' = the reverse. */
export async function postPartyOpening(client, party, { amount, type, date }) {
  await clear(client, "party_ledger_entries", ["opening"], party.id);
  await partyEntry(client, {
    businessId: party.business_id,
    partyId: party.id,
    date,
    sourceType: "opening",
    sourceId: party.id,
    side: type === "payable" ? "credit" : "debit",
    amount: amount ?? 0,
    narration: "Opening balance",
  });
}

/** Signed: a negative opening balance is an overdraft. */
export async function postAccountOpening(client, account, { amount, date }) {
  await clear(client, "account_entries", ["opening"], account.id);
  await accountEntry(client, {
    businessId: account.business_id,
    accountId: account.id,
    date,
    sourceType: "opening",
    sourceId: account.id,
    amount: amount ?? 0,
    narration: "Opening balance",
  });
}

export async function postItemOpening(client, item, { quantity, unitCost, date }) {
  await clear(client, "stock_movements", ["opening"], item.id);
  await stockMovement(client, {
    businessId: item.business_id,
    itemId: item.id,
    date,
    quantity: quantity ?? 0,
    unitCost,
    sourceType: "opening",
    sourceId: item.id,
  });
}
