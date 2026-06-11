import pool from "../../../db/db.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function getProfitAndLoss(req, res) {
  const { businessId } = req.params;
  const { from_date, to_date } = req.query;

  let invoiceFilter = "AND business_id = $1";
  let expenseFilter = "AND business_id = $1";
  const params = [businessId];
  let idx = 2;

  if (from_date) {
    invoiceFilter += ` AND invoice_date >= $${idx}`;
    expenseFilter += ` AND expense_date >= $${idx}`;
    params.push(new Date(from_date));
    idx++;
  }

  if (to_date) {
    invoiceFilter += ` AND invoice_date <= $${idx}`;
    expenseFilter += ` AND expense_date <= $${idx}`;
    params.push(new Date(to_date));
    idx++;
  }

  const salesQuery = `SELECT SUM(total_amount) as total FROM invoices WHERE invoice_type = 'sale' ${invoiceFilter}`;
  const salesReturnQuery = `SELECT SUM(total_amount) as total FROM invoices WHERE invoice_type = 'sale_return' ${invoiceFilter}`;
  const purchasesQuery = `SELECT SUM(total_amount) as total FROM invoices WHERE invoice_type = 'purchase' ${invoiceFilter}`;
  const purchasesReturnQuery = `SELECT SUM(total_amount) as total FROM invoices WHERE invoice_type = 'purchase_return' ${invoiceFilter}`;
  const expensesQuery = `SELECT SUM(total_amount) as total FROM expenses WHERE 1=1 ${expenseFilter}`;

  const salesRes = await pool.query(salesQuery, params);
  const salesReturnRes = await pool.query(salesReturnQuery, params);
  const purchasesRes = await pool.query(purchasesQuery, params);
  const purchasesReturnRes = await pool.query(purchasesReturnQuery, params);
  const expensesRes = await pool.query(expensesQuery, params);

  const grossSales = Number(salesRes.rows[0]?.total || 0);
  const salesReturns = Number(salesReturnRes.rows[0]?.total || 0);
  const netRevenue = round2(grossSales - salesReturns);

  const grossPurchases = Number(purchasesRes.rows[0]?.total || 0);
  const purchaseReturns = Number(purchasesReturnRes.rows[0]?.total || 0);
  const netPurchases = round2(grossPurchases - purchaseReturns);

  const totalExpenses = round2(expensesRes.rows[0]?.total || 0);
  const netProfit = round2(netRevenue - netPurchases - totalExpenses);

  res.status(200).json({
    gross_sales: grossSales,
    sales_returns: salesReturns,
    net_revenue: netRevenue,
    gross_purchases: grossPurchases,
    purchase_returns: purchaseReturns,
    net_purchases: netPurchases,
    operating_expenses: totalExpenses,
    net_profit: netProfit,
  });
}
