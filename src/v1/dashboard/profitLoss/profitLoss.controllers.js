import pool from "../../../db/db.js";
import { getCache, setCache } from "../../../utils/redisClient.js";
import { cacheKeys } from "../../../utils/cacheKeys.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function getProfitAndLoss(req, res) {
  const { businessId } = req.params;
  const { from_date, to_date } = req.query;

  const cacheKey = cacheKeys.dashboardProfitLoss(businessId, from_date || "", to_date || "");
  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  let invoiceFilter = "AND business_id = $1";
  let expenseFilter = "AND business_id = $1";
  const params = [businessId];

  if (from_date) {
    invoiceFilter += ` AND invoice_date >= $2`;
    expenseFilter += ` AND expense_date >= $2`;
  }

  if (to_date) {
    invoiceFilter += ` AND invoice_date <= $3`;
    expenseFilter += ` AND expense_date <= $3`;
  }

  const paramsWithDates = [businessId];
  if (from_date) {
    paramsWithDates.push(new Date(from_date));
  }
  if (to_date) {
    paramsWithDates.push(new Date(to_date));
  }

  const salesQuery = `SELECT SUM(total_amount) as total FROM invoices WHERE invoice_type = 'sale' ${invoiceFilter}`;
  const salesReturnQuery = `SELECT SUM(total_amount) as total FROM invoices WHERE invoice_type = 'sale_return' ${invoiceFilter}`;
  const purchasesQuery = `SELECT SUM(total_amount) as total FROM invoices WHERE invoice_type = 'purchase' ${invoiceFilter}`;
  const purchasesReturnQuery = `SELECT SUM(total_amount) as total FROM invoices WHERE invoice_type = 'purchase_return' ${invoiceFilter}`;
  const expensesQuery = `SELECT SUM(total_amount) as total FROM expenses WHERE 1=1 ${expenseFilter}`;

  const [salesRes, salesReturnRes, purchasesRes, purchasesReturnRes, expensesRes] = await Promise.all([
    pool.query(salesQuery, paramsWithDates),
    pool.query(salesReturnQuery, paramsWithDates),
    pool.query(purchasesQuery, paramsWithDates),
    pool.query(purchasesReturnQuery, paramsWithDates),
    pool.query(expensesQuery, paramsWithDates),
  ]);

  const grossSales = Number(salesRes.rows[0]?.total || 0);
  const salesReturns = Number(salesReturnRes.rows[0]?.total || 0);
  const netRevenue = round2(grossSales - salesReturns);

  const grossPurchases = Number(purchasesRes.rows[0]?.total || 0);
  const purchaseReturns = Number(purchasesReturnRes.rows[0]?.total || 0);
  const netPurchases = round2(grossPurchases - purchaseReturns);

  const totalExpenses = round2(expensesRes.rows[0]?.total || 0);
  const netProfit = round2(netRevenue - netPurchases - totalExpenses);

  const result = {
    gross_sales: grossSales,
    sales_returns: salesReturns,
    net_revenue: netRevenue,
    gross_purchases: grossPurchases,
    purchase_returns: purchaseReturns,
    net_purchases: netPurchases,
    operating_expenses: totalExpenses,
    net_profit: netProfit,
  };

  await setCache(cacheKey, result, 300);

  res.status(200).json(result);
}
