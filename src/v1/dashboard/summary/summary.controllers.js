import pool from "../../../db/db.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function getDashboardSummary(req, res) {
  const { businessId } = req.params;

  const lowStockRes = { rowCount: 0, rows: [] };

  const [
    salesRes,
    purchasesRes,
    receivablesRes,
    payablesRes,
    flowsRes,
    payFlowsRes,
    expFlowsRes,
  ] = await Promise.all([
    pool.query(
      "SELECT SUM(total_amount) as total, SUM(tax_amount) as tax FROM invoices WHERE business_id = $1 AND invoice_type = 'sale'",
      [businessId]
    ),
    pool.query(
      "SELECT SUM(total_amount) as total, SUM(tax_amount) as tax FROM invoices WHERE business_id = $1 AND invoice_type = 'purchase'",
      [businessId]
    ),
    pool.query(
      "SELECT SUM(current_balance) as total FROM parties WHERE business_id = $1 AND current_balance > 0",
      [businessId]
    ),
    pool.query(
      "SELECT SUM(current_balance) as total FROM parties WHERE business_id = $1 AND current_balance < 0",
      [businessId]
    ),
    pool.query(
      `
      SELECT 
        COALESCE(SUM(CASE WHEN invoice_type = 'sale' AND payment_mode = 'cash' THEN paid_amount END), 0) as inv_sale_cash_in,
        COALESCE(SUM(CASE WHEN invoice_type = 'sale' AND payment_mode = 'bank' THEN paid_amount END), 0) as inv_sale_bank_in,
        COALESCE(SUM(CASE WHEN invoice_type = 'sale' AND payment_mode = 'upi' THEN paid_amount END), 0) as inv_sale_upi_in,
        
        COALESCE(SUM(CASE WHEN invoice_type = 'purchase_return' AND payment_mode = 'cash' THEN paid_amount END), 0) as inv_pr_cash_in,
        COALESCE(SUM(CASE WHEN invoice_type = 'purchase_return' AND payment_mode = 'bank' THEN paid_amount END), 0) as inv_pr_bank_in,
        COALESCE(SUM(CASE WHEN invoice_type = 'purchase_return' AND payment_mode = 'upi' THEN paid_amount END), 0) as inv_pr_upi_in,
  
        COALESCE(SUM(CASE WHEN invoice_type = 'purchase' AND payment_mode = 'cash' THEN paid_amount END), 0) as inv_pur_cash_out,
        COALESCE(SUM(CASE WHEN invoice_type = 'purchase' AND payment_mode = 'bank' THEN paid_amount END), 0) as inv_pur_bank_out,
        COALESCE(SUM(CASE WHEN invoice_type = 'purchase' AND payment_mode = 'upi' THEN paid_amount END), 0) as inv_pur_upi_out,
  
        COALESCE(SUM(CASE WHEN invoice_type = 'sale_return' AND payment_mode = 'cash' THEN paid_amount END), 0) as inv_sr_cash_out,
        COALESCE(SUM(CASE WHEN invoice_type = 'sale_return' AND payment_mode = 'bank' THEN paid_amount END), 0) as inv_sr_bank_out,
        COALESCE(SUM(CASE WHEN invoice_type = 'sale_return' AND payment_mode = 'upi' THEN paid_amount END), 0) as inv_sr_upi_out
      FROM invoices 
      WHERE business_id = $1
      `,
      [businessId]
    ),
    pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN payment_type = 'payment_in' AND payment_mode = 'cash' THEN amount END), 0) as pay_in_cash,
        COALESCE(SUM(CASE WHEN payment_type = 'payment_in' AND payment_mode = 'bank' THEN amount END), 0) as pay_in_bank,
        COALESCE(SUM(CASE WHEN payment_type = 'payment_in' AND payment_mode = 'upi' THEN amount END), 0) as pay_in_upi,
  
        COALESCE(SUM(CASE WHEN payment_type = 'payment_out' AND payment_mode = 'cash' THEN amount END), 0) as pay_out_cash,
        COALESCE(SUM(CASE WHEN payment_type = 'payment_out' AND payment_mode = 'bank' THEN amount END), 0) as pay_out_bank,
        COALESCE(SUM(CASE WHEN payment_type = 'payment_out' AND payment_mode = 'upi' THEN amount END), 0) as pay_out_upi
      FROM payments
      WHERE business_id = $1
      `,
      [businessId]
    ),
    pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN payment_mode = 'cash' THEN paid_amount END), 0) as exp_cash,
        COALESCE(SUM(CASE WHEN payment_mode = 'bank' THEN paid_amount END), 0) as exp_bank,
        COALESCE(SUM(CASE WHEN payment_mode = 'upi' THEN paid_amount END), 0) as exp_upi
      FROM expenses
      WHERE business_id = $1
      `,
      [businessId]
    ),
  ]);

  const invFlow = flowsRes.rows[0];
  const payFlow = payFlowsRes.rows[0];
  const expFlow = expFlowsRes.rows[0];

  const cashBalance = round2(
    Number(invFlow.inv_sale_cash_in) +
      Number(invFlow.inv_pr_cash_in) +
      Number(payFlow.pay_in_cash) -
      (Number(invFlow.inv_pur_cash_out) +
        Number(invFlow.inv_sr_cash_out) +
        Number(payFlow.pay_out_cash) +
        Number(expFlow.exp_cash))
  );

  const bankBalance = round2(
    Number(invFlow.inv_sale_bank_in) +
      Number(invFlow.inv_pr_bank_in) +
      Number(payFlow.pay_in_bank) -
      (Number(invFlow.inv_pur_bank_out) +
        Number(invFlow.inv_sr_bank_out) +
        Number(payFlow.pay_out_bank) +
        Number(expFlow.exp_bank))
  );

  const upiBalance = round2(
    Number(invFlow.inv_sale_upi_in) +
      Number(invFlow.inv_pr_upi_in) +
      Number(payFlow.pay_in_upi) -
      (Number(invFlow.inv_pur_upi_out) +
        Number(invFlow.inv_sr_upi_out) +
        Number(payFlow.pay_out_upi) +
        Number(expFlow.exp_upi))
  );

  const salesTotal = Number(salesRes.rows[0]?.total || 0);
  const salesTax = Number(salesRes.rows[0]?.tax || 0);
  const salesBase = salesTotal - salesTax;

  const purchasesTotal = Number(purchasesRes.rows[0]?.total || 0);
  const purchasesTax = Number(purchasesRes.rows[0]?.tax || 0);
  const purchasesBase = purchasesTotal - purchasesTax;

  const receivablesTotal = Number(receivablesRes.rows[0]?.total || 0);
  const salesTaxRatio = salesTotal > 0 ? salesTax / salesTotal : 0;
  const receivablesTax = receivablesTotal * salesTaxRatio;
  const receivablesBase = receivablesTotal - receivablesTax;

  const payablesTotal = Math.abs(Number(payablesRes.rows[0]?.total || 0));
  const purchasesTaxRatio = purchasesTotal > 0 ? purchasesTax / purchasesTotal : 0;
  const payablesTax = payablesTotal * purchasesTaxRatio;
  const payablesBase = payablesTotal - payablesTax;

  const receivedTotal = salesTotal - receivablesTotal;
  const receivedBase = salesBase - receivablesBase;
  const receivedTax = salesTax - receivablesTax;

  const totalPaidTotal = purchasesTotal - payablesTotal;
  const totalPaidBase = purchasesBase - payablesBase;
  const totalPaidTax = purchasesTax - payablesTax;

  res.status(200).json({
    total_sales: {
      base: round2(salesBase),
      tax: round2(salesTax),
      total: round2(salesTotal),
    },
    total_purchases: {
      base: round2(purchasesBase),
      tax: round2(purchasesTax),
      total: round2(purchasesTotal),
    },
    total_receivables: {
      base: round2(receivablesBase),
      tax: round2(receivablesTax),
      total: round2(receivablesTotal),
    },
    total_payables: {
      base: round2(payablesBase),
      tax: round2(payablesTax),
      total: round2(payablesTotal),
    },
    received: {
      base: round2(receivedBase),
      tax: round2(receivedTax),
      total: round2(receivedTotal),
    },
    total_paid: {
      base: round2(totalPaidBase),
      tax: round2(totalPaidTax),
      total: round2(totalPaidTotal),
    },
    low_stock_items_count: lowStockRes.rowCount,
    low_stock_items: lowStockRes.rows,
    cash_book: {
      cash: cashBalance,
      bank: bankBalance,
      upi: upiBalance,
      total_money: round2(cashBalance + bankBalance + upiBalance),
    },
  });
}
