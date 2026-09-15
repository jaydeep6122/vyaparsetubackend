import { Filters, likePattern } from "../../db/sql.js";
import { withTransaction } from "../../db/transaction.js";
import { ApiError } from "../../utils/ApiError.js";
import { financialYearStart, today } from "../../utils/fy.js";
import { dec, money, sum } from "../../utils/money.js";

// Every report reads from the ledgers inside one read-only snapshot, so the
// numbers on a page always agree with each other.
const readOnly = (fn) => withTransaction(fn, { readOnly: true });

/** Defaults to the current financial year up to today. */
const periodOf = (business, query) => ({
  from: query.from ?? financialYearStart(today(), business.fy_start_month),
  to: query.to ?? today(),
});

const moneySum = (rows, key) => money(sum(rows.map((row) => row[key])));

export async function dashboard(ctx, query) {
  const period = periodOf(ctx.business, query);
  const businessId = ctx.business.id;
  const inPeriod = [businessId, period.from, period.to];

  return readOnly(async (client) => {
    const {
      rows: [parties],
    } = await client.query(
      `SELECT COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0)::numeric(15,2) AS receivable,
              COALESCE(-SUM(balance) FILTER (WHERE balance < 0), 0)::numeric(15,2) AS payable
       FROM (
         SELECT SUM(debit - credit) AS balance
         FROM party_ledger_entries WHERE business_id = $1
         GROUP BY party_id
       ) balances`,
      [businessId],
    );

    const { rows: accounts } = await client.query(
      `SELECT a.id, a.name, a.account_type, COALESCE(SUM(e.amount), 0)::numeric(15,2) AS balance
       FROM accounts a LEFT JOIN account_entries e ON e.account_id = a.id
       WHERE a.business_id = $1 AND a.archived_at IS NULL
       GROUP BY a.id
       ORDER BY a.account_type = 'bank', a.is_default DESC, lower(a.name)`,
      [businessId],
    );

    const {
      rows: [invoices],
    } = await client.query(
      `SELECT COALESCE(SUM(total_amount) FILTER (WHERE invoice_type = 'sale'), 0)::numeric(15,2) AS sales,
              COALESCE(SUM(total_amount) FILTER (WHERE invoice_type = 'sale_return'), 0)::numeric(15,2) AS sale_returns,
              COALESCE(SUM(total_amount) FILTER (WHERE invoice_type = 'purchase'), 0)::numeric(15,2) AS purchases,
              COALESCE(SUM(total_amount) FILTER (WHERE invoice_type = 'purchase_return'), 0)::numeric(15,2) AS purchase_returns,
              COUNT(*) FILTER (WHERE invoice_type = 'sale') AS sale_count
       FROM invoices
       WHERE business_id = $1 AND status = 'final' AND invoice_date BETWEEN $2 AND $3`,
      inPeriod,
    );

    const {
      rows: [cashflow],
    } = await client.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE payment_type = 'in'), 0)::numeric(15,2) AS received,
              COALESCE(SUM(amount) FILTER (WHERE payment_type = 'out'), 0)::numeric(15,2) AS paid
       FROM payments
       WHERE business_id = $1 AND status = 'active' AND payment_date BETWEEN $2 AND $3`,
      inPeriod,
    );

    const {
      rows: [expenses],
    } = await client.query(
      `SELECT COALESCE(SUM(total_amount), 0)::numeric(15,2) AS total
       FROM expenses
       WHERE business_id = $1 AND status = 'active' AND expense_date BETWEEN $2 AND $3`,
      inPeriod,
    );

    const {
      rows: [overdue],
    } = await client.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount - amount_settled), 0)::numeric(15,2) AS amount
       FROM invoices
       WHERE business_id = $1 AND status = 'final' AND invoice_type = 'sale'
         AND amount_settled < total_amount AND due_date < $2`,
      [businessId, today()],
    );

    const { rows: lowStock } = await client.query(
      `SELECT i.id, i.name, i.unit_code, i.low_stock_threshold,
              COALESCE(SUM(m.quantity), 0)::numeric(15,3) AS quantity_on_hand
       FROM items i LEFT JOIN stock_movements m ON m.item_id = i.id
       WHERE i.business_id = $1 AND i.track_stock AND i.archived_at IS NULL AND i.low_stock_threshold IS NOT NULL
       GROUP BY i.id
       HAVING COALESCE(SUM(m.quantity), 0) <= i.low_stock_threshold
       ORDER BY i.name
       LIMIT 20`,
      [businessId],
    );

    const net = (gross, returns) => ({ gross, returns, net: money(dec(gross).minus(returns)) });
    const accountsOfType = (type) => accounts.filter((account) => account.account_type === type);

    return {
      period,
      receivable: parties.receivable,
      payable: parties.payable,
      cash_balance: moneySum(accountsOfType("cash"), "balance"),
      bank_balance: moneySum(accountsOfType("bank"), "balance"),
      accounts,
      sales: { ...net(invoices.sales, invoices.sale_returns), count: invoices.sale_count },
      purchases: net(invoices.purchases, invoices.purchase_returns),
      received: cashflow.received,
      paid: cashflow.paid,
      expenses: expenses.total,
      overdue_receivables: overdue,
      low_stock: lowStock,
    };
  });
}

export async function partyLedger(ctx, partyId, query) {
  const period = periodOf(ctx.business, query);

  return readOnly(async (client) => {
    const {
      rows: [party],
    } = await client.query(
      "SELECT id, name, party_type, phone, gstin FROM parties WHERE id = $1 AND business_id = $2",
      [partyId, ctx.business.id],
    );
    if (!party) throw new ApiError(404, "Party not found");

    const {
      rows: [{ opening }],
    } = await client.query(
      `SELECT COALESCE(SUM(debit - credit), 0)::numeric(15,2) AS opening
       FROM party_ledger_entries
       WHERE business_id = $1 AND party_id = $2 AND entry_date < $3`,
      [ctx.business.id, partyId, period.from],
    );

    const { rows: entries } = await client.query(
      `SELECT id, entry_date, source_type, source_id, debit, credit, narration,
              ($4::numeric + SUM(debit - credit) OVER (ORDER BY entry_date, id))::numeric(15,2) AS balance
       FROM party_ledger_entries
       WHERE business_id = $1 AND party_id = $2 AND entry_date BETWEEN $3 AND $5
       ORDER BY entry_date, id`,
      [ctx.business.id, partyId, period.from, opening, period.to],
    );

    return {
      party,
      period,
      opening_balance: opening,
      total_debit: moneySum(entries, "debit"),
      total_credit: moneySum(entries, "credit"),
      closing_balance: entries.at(-1)?.balance ?? opening,
      entries,
    };
  });
}

export async function accountBook(ctx, accountId, query) {
  const period = periodOf(ctx.business, query);

  return readOnly(async (client) => {
    const {
      rows: [account],
    } = await client.query("SELECT id, name, account_type FROM accounts WHERE id = $1 AND business_id = $2", [
      accountId,
      ctx.business.id,
    ]);
    if (!account) throw new ApiError(404, "Account not found");

    const {
      rows: [{ opening }],
    } = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric(15,2) AS opening
       FROM account_entries
       WHERE business_id = $1 AND account_id = $2 AND entry_date < $3`,
      [ctx.business.id, accountId, period.from],
    );

    const { rows: entries } = await client.query(
      `SELECT id, entry_date, source_type, source_id, amount, narration,
              ($4::numeric + SUM(amount) OVER (ORDER BY entry_date, id))::numeric(15,2) AS balance
       FROM account_entries
       WHERE business_id = $1 AND account_id = $2 AND entry_date BETWEEN $3 AND $5
       ORDER BY entry_date, id`,
      [ctx.business.id, accountId, period.from, opening, period.to],
    );

    return {
      account,
      period,
      opening_balance: opening,
      total_in: money(sum(entries.filter((entry) => dec(entry.amount).gt(0)).map((entry) => entry.amount))),
      total_out: money(
        sum(entries.filter((entry) => dec(entry.amount).lt(0)).map((entry) => dec(entry.amount).negated())),
      ),
      closing_balance: entries.at(-1)?.balance ?? opening,
      entries,
    };
  });
}

export async function stockSummary(ctx, query) {
  return readOnly(async (client) => {
    const filters = new Filters().add("i.business_id = ?", ctx.business.id).add("i.archived_at IS NULL");
    filters.addIf(query.search, "i.name ILIKE ?", query.search && likePattern(query.search));
    filters.addIf(
      query.low_stock,
      "i.low_stock_threshold IS NOT NULL AND s.quantity_on_hand <= i.low_stock_threshold",
    );

    const { rows: items } = await client.query(
      `SELECT i.id, i.name, i.sku, i.unit_code, i.low_stock_threshold,
              s.quantity_on_hand, s.average_cost,
              (s.quantity_on_hand * COALESCE(s.average_cost, 0))::numeric(15,2) AS stock_value,
              (i.low_stock_threshold IS NOT NULL AND s.quantity_on_hand <= i.low_stock_threshold) AS is_low
       FROM items i JOIN item_stock s ON s.item_id = i.id
       ${filters.where}
       ORDER BY lower(i.name)`,
      filters.values,
    );
    return { items, total_value: moneySum(items, "stock_value") };
  });
}

const bucketOf = (daysOverdue) =>
  daysOverdue <= 0
    ? "not_due"
    : daysOverdue <= 30
      ? "1_30"
      : daysOverdue <= 60
        ? "31_60"
        : daysOverdue <= 90
          ? "61_90"
          : "over_90";

/**
 * Unpaid documents with ageing. Payables also include freight and other
 * charges owed to a payee, and expenses owed to a vendor.
 */
export async function outstanding(ctx, query) {
  const type = query.type ?? "receivable";
  const asOf = today();
  const params = [ctx.business.id, type === "payable" ? ["purchase", "sale_return"] : ["sale", "purchase_return"], asOf];
  if (query.party_id) params.push(query.party_id);
  const forParty = (column) => (query.party_id ? `AND ${column} = $4` : "");

  let sql = `
    SELECT 'invoice' AS kind, i.id, i.invoice_number AS number, i.invoice_type AS document_type,
           i.invoice_date AS document_date, i.due_date, i.party_id, i.party_name,
           i.total_amount, i.amount_settled, (i.total_amount - i.amount_settled)::numeric(15,2) AS outstanding,
           ($3::date - COALESCE(i.due_date, i.invoice_date)) AS days_overdue
    FROM invoices i
    WHERE i.business_id = $1 AND i.status = 'final' AND i.amount_settled < i.total_amount
      AND i.invoice_type = ANY($2::text[]) ${forParty("i.party_id")}`;

  if (type === "payable") {
    sql += `
    UNION ALL
    SELECT 'charge', c.id, i.invoice_number, c.charge_type, i.invoice_date, NULL::date, c.payee_party_id, p.name,
           (c.amount + c.tax_amount)::numeric(15,2), c.amount_settled,
           (c.amount + c.tax_amount - c.amount_settled)::numeric(15,2), ($3::date - i.invoice_date)
    FROM invoice_charges c
    JOIN invoices i ON i.id = c.invoice_id
    JOIN parties p ON p.id = c.payee_party_id
    WHERE c.business_id = $1 AND i.status = 'final' AND c.amount_settled < c.amount + c.tax_amount
      ${forParty("c.payee_party_id")}
    UNION ALL
    SELECT 'expense', e.id, e.expense_number, 'expense', e.expense_date, NULL::date, e.party_id, p.name,
           e.total_amount, e.amount_settled, (e.total_amount - e.amount_settled)::numeric(15,2),
           ($3::date - e.expense_date)
    FROM expenses e
    JOIN parties p ON p.id = e.party_id
    WHERE e.business_id = $1 AND e.status = 'active' AND e.amount_settled < e.total_amount
      ${forParty("e.party_id")}`;
  }

  return readOnly(async (client) => {
    const { rows: documents } = await client.query(`${sql} ORDER BY days_overdue DESC, number`, params);

    const buckets = { not_due: dec(0), "1_30": dec(0), "31_60": dec(0), "61_90": dec(0), over_90: dec(0) };
    for (const document of documents) {
      const bucket = bucketOf(document.days_overdue);
      document.bucket = bucket;
      buckets[bucket] = buckets[bucket].plus(document.outstanding);
    }

    return {
      type,
      as_of: asOf,
      total: moneySum(documents, "outstanding"),
      buckets: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, money(value)])),
      documents,
    };
  });
}

/**
 * Profit & loss on taxable values (GST is neither income nor cost). Stock
 * items are costed when sold, at their weighted average purchase cost.
 */
export async function profitLoss(ctx, query) {
  const period = periodOf(ctx.business, query);
  const params = [ctx.business.id, period.from, period.to];

  return readOnly(async (client) => {
    const {
      rows: [trading],
    } = await client.query(
      `SELECT
         COALESCE(SUM(CASE invoice_type WHEN 'sale' THEN taxable_total WHEN 'sale_return' THEN -taxable_total ELSE 0 END), 0)::numeric(15,2) AS net_sales,
         COALESCE(SUM(CASE invoice_type WHEN 'purchase' THEN taxable_total WHEN 'purchase_return' THEN -taxable_total ELSE 0 END), 0)::numeric(15,2) AS net_purchases
       FROM invoices
       WHERE business_id = $1 AND status = 'final' AND invoice_date BETWEEN $2 AND $3`,
      params,
    );

    const {
      rows: [charges],
    } = await client.query(
      `SELECT
         COALESCE(SUM(CASE
           WHEN c.bill_to = 'invoice_party' AND i.invoice_type = 'sale' THEN c.amount
           WHEN c.bill_to = 'invoice_party' AND i.invoice_type = 'sale_return' THEN -c.amount
           ELSE 0 END), 0)::numeric(15,2) AS recovered,
         COALESCE(SUM(CASE
           WHEN c.payee_party_id IS NOT NULL THEN c.amount
           WHEN i.invoice_type = 'purchase' THEN c.amount
           WHEN i.invoice_type = 'purchase_return' THEN -c.amount
           ELSE 0 END), 0)::numeric(15,2) AS paid
       FROM invoice_charges c JOIN invoices i ON i.id = c.invoice_id
       WHERE c.business_id = $1 AND i.status = 'final' AND i.invoice_date BETWEEN $2 AND $3`,
      params,
    );

    const {
      rows: [cogs],
    } = await client.query(
      `SELECT COALESCE(SUM(-m.quantity * COALESCE(s.average_cost, 0)), 0)::numeric(15,2) AS amount
       FROM stock_movements m
       JOIN invoices i ON i.id = m.source_id AND m.source_type = 'invoice'
       JOIN item_stock s ON s.item_id = m.item_id
       WHERE m.business_id = $1 AND i.invoice_type IN ('sale', 'sale_return')
         AND m.movement_date BETWEEN $2 AND $3`,
      params,
    );

    const {
      rows: [nonStock],
    } = await client.query(
      `SELECT COALESCE(SUM(CASE WHEN i.invoice_type = 'purchase' THEN l.taxable_value ELSE -l.taxable_value END), 0)::numeric(15,2) AS amount
       FROM invoice_lines l
       JOIN invoices i ON i.id = l.invoice_id
       LEFT JOIN items it ON it.id = l.item_id
       WHERE i.business_id = $1 AND i.status = 'final' AND i.invoice_type IN ('purchase', 'purchase_return')
         AND i.invoice_date BETWEEN $2 AND $3 AND (it.id IS NULL OR NOT it.track_stock)`,
      params,
    );

    const {
      rows: [expenses],
    } = await client.query(
      `SELECT COALESCE(SUM(taxable_amount + CASE WHEN itc_eligible THEN 0
                ELSE cgst_amount + sgst_amount + igst_amount + cess_amount END), 0)::numeric(15,2) AS amount
       FROM expenses
       WHERE business_id = $1 AND status = 'active' AND expense_date BETWEEN $2 AND $3`,
      params,
    );

    const revenue = dec(trading.net_sales).plus(charges.recovered);
    const directCosts = dec(cogs.amount).plus(nonStock.amount).plus(charges.paid);
    const grossProfit = revenue.minus(directCosts);

    return {
      period,
      net_sales: trading.net_sales,
      charges_recovered: charges.recovered,
      revenue: money(revenue),
      cost_of_goods_sold: cogs.amount,
      non_stock_purchases: nonStock.amount,
      freight_and_charges: charges.paid,
      gross_profit: money(grossProfit),
      expenses: expenses.amount,
      net_profit: money(grossProfit.minus(expenses.amount)),
      net_purchases: trading.net_purchases,
    };
  });
}

/** GST collected and paid in a period, with an HSN-wise summary of sales. */
export async function gstSummary(ctx, query) {
  const period = periodOf(ctx.business, query);
  const params = [ctx.business.id, period.from, period.to];
  const signed = (column, positiveType) =>
    `COALESCE(SUM(CASE WHEN invoice_type = '${positiveType}' THEN ${column} ELSE -${column} END), 0)::numeric(15,2)`;
  const taxColumns = (positiveType) => `
    ${signed("taxable_total", positiveType)} AS taxable,
    ${signed("cgst_total", positiveType)} AS cgst,
    ${signed("sgst_total", positiveType)} AS sgst,
    ${signed("igst_total", positiveType)} AS igst,
    ${signed("cess_total", positiveType)} AS cess`;

  return readOnly(async (client) => {
    const {
      rows: [output],
    } = await client.query(
      `SELECT ${taxColumns("sale")},
              ${signed("CASE WHEN party_gstin IS NOT NULL THEN taxable_total ELSE 0 END", "sale")} AS b2b_taxable,
              ${signed("CASE WHEN party_gstin IS NULL THEN taxable_total ELSE 0 END", "sale")} AS b2c_taxable
       FROM invoices
       WHERE business_id = $1 AND status = 'final' AND tax_mode = 'gst'
         AND invoice_type IN ('sale', 'sale_return') AND invoice_date BETWEEN $2 AND $3`,
      params,
    );

    const {
      rows: [chargeTax],
    } = await client.query(
      `SELECT COALESCE(SUM(CASE WHEN i.invoice_type = 'sale' THEN c.tax_amount ELSE -c.tax_amount END), 0)::numeric(15,2) AS amount
       FROM invoice_charges c JOIN invoices i ON i.id = c.invoice_id
       WHERE c.business_id = $1 AND c.bill_to = 'invoice_party' AND i.status = 'final' AND i.tax_mode = 'gst'
         AND i.invoice_type IN ('sale', 'sale_return') AND i.invoice_date BETWEEN $2 AND $3`,
      params,
    );

    const {
      rows: [purchases],
    } = await client.query(
      `SELECT ${taxColumns("purchase")}
       FROM invoices
       WHERE business_id = $1 AND status = 'final' AND tax_mode = 'gst'
         AND invoice_type IN ('purchase', 'purchase_return') AND invoice_date BETWEEN $2 AND $3`,
      params,
    );

    const {
      rows: [expenses],
    } = await client.query(
      `SELECT COALESCE(SUM(taxable_amount), 0)::numeric(15,2) AS taxable,
              COALESCE(SUM(cgst_amount), 0)::numeric(15,2) AS cgst,
              COALESCE(SUM(sgst_amount), 0)::numeric(15,2) AS sgst,
              COALESCE(SUM(igst_amount), 0)::numeric(15,2) AS igst,
              COALESCE(SUM(cess_amount), 0)::numeric(15,2) AS cess
       FROM expenses
       WHERE business_id = $1 AND status = 'active' AND tax_mode = 'gst' AND itc_eligible
         AND expense_date BETWEEN $2 AND $3`,
      params,
    );

    const { rows: hsnSummary } = await client.query(
      `SELECT l.hsn_sac, l.unit_code, l.tax_rate,
              SUM(s.sign * l.quantity)::numeric(15,3) AS quantity,
              SUM(s.sign * l.taxable_value)::numeric(15,2) AS taxable_value,
              SUM(s.sign * l.cgst_amount)::numeric(15,2) AS cgst,
              SUM(s.sign * l.sgst_amount)::numeric(15,2) AS sgst,
              SUM(s.sign * l.igst_amount)::numeric(15,2) AS igst,
              SUM(s.sign * l.cess_amount)::numeric(15,2) AS cess
       FROM invoice_lines l
       JOIN invoices i ON i.id = l.invoice_id
       CROSS JOIN LATERAL (SELECT CASE WHEN i.invoice_type = 'sale' THEN 1 ELSE -1 END AS sign) s
       WHERE i.business_id = $1 AND i.status = 'final' AND i.tax_mode = 'gst'
         AND i.invoice_type IN ('sale', 'sale_return') AND i.invoice_date BETWEEN $2 AND $3
       GROUP BY l.hsn_sac, l.unit_code, l.tax_rate
       ORDER BY l.hsn_sac NULLS LAST, l.tax_rate`,
      params,
    );

    const {
      rows: [nonGst],
    } = await client.query(
      `SELECT COALESCE(SUM(CASE invoice_type WHEN 'sale' THEN total_amount WHEN 'sale_return' THEN -total_amount ELSE 0 END), 0)::numeric(15,2) AS sales
       FROM invoices
       WHERE business_id = $1 AND status = 'final' AND tax_mode = 'non_gst' AND invoice_date BETWEEN $2 AND $3`,
      params,
    );

    const input = Object.fromEntries(
      ["taxable", "cgst", "sgst", "igst", "cess"].map((key) => [key, money(dec(purchases[key]).plus(expenses[key]))]),
    );
    const taxTotal = (row) => dec(row.cgst).plus(row.sgst).plus(row.igst).plus(row.cess);

    return {
      period,
      output: { ...output, charges_tax: chargeTax.amount },
      input,
      net_tax_payable: money(taxTotal(output).plus(chargeTax.amount).minus(taxTotal(input))),
      non_gst_sales: nonGst.sales,
      hsn_summary: hsnSummary,
    };
  });
}

export async function dayBook(ctx, query) {
  const day = query.date ?? today();

  return readOnly(async (client) => {
    const { rows: entries } = await client.query(
      `SELECT 'invoice' AS kind, i.id, i.invoice_type AS type, i.invoice_number AS number,
              i.party_name AS party, i.total_amount AS amount, i.status, i.created_at
       FROM invoices i WHERE i.business_id = $1 AND i.invoice_date = $2
       UNION ALL
       SELECT 'payment', p.id, p.payment_type, p.payment_number, pt.name, p.amount, p.status, p.created_at
       FROM payments p LEFT JOIN parties pt ON pt.id = p.party_id
       WHERE p.business_id = $1 AND p.payment_date = $2
       UNION ALL
       SELECT 'expense', e.id, 'expense', e.expense_number, pt.name, e.total_amount, e.status, e.created_at
       FROM expenses e LEFT JOIN parties pt ON pt.id = e.party_id
       WHERE e.business_id = $1 AND e.expense_date = $2
       UNION ALL
       SELECT 'transfer', t.id, 'transfer', NULL, NULL, t.amount, t.status, t.created_at
       FROM account_transfers t WHERE t.business_id = $1 AND t.transfer_date = $2
       ORDER BY created_at`,
      [ctx.business.id, day],
    );
    return { date: day, entries };
  });
}
