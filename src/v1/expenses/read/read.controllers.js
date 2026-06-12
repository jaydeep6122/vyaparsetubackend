import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import { getCache, setCache } from "../../../utils/redisClient.js";
import { cacheKeys } from "../../../utils/cacheKeys.js";

export async function listExpenses(req, res) {
  const { businessId } = req.params;
  const { expense_category, from_date, to_date, search } = req.query;

  const queryString = `${expense_category || ""}:${from_date || ""}:${to_date || ""}:${search || ""}`;
  const cacheKey = cacheKeys.expenseList(businessId);
  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  let query = "SELECT * FROM expenses WHERE business_id = $1";
  const values = [businessId];
  let paramIndex = 2;

  if (expense_category) {
    query += ` AND expense_category = $${paramIndex}`;
    values.push(expense_category);
    paramIndex++;
  }

  if (from_date) {
    query += ` AND expense_date >= $${paramIndex}`;
    values.push(new Date(from_date));
    paramIndex++;
  }

  if (to_date) {
    query += ` AND expense_date <= $${paramIndex}`;
    values.push(new Date(to_date));
    paramIndex++;
  }

  if (search) {
    query += ` AND (description ILIKE $${paramIndex} OR expense_number ILIKE $${paramIndex})`;
    values.push(`%${search}%`);
    paramIndex++;
  }

  query += " ORDER BY expense_date DESC, created_at DESC";

  const result = await pool.query(query, values);
  await setCache(cacheKey, result.rows, 60);
  res.status(200).json(result.rows);
}

export async function getExpenseById(req, res) {
  const { businessId, expenseId } = req.params;

  const cacheKey = cacheKeys.expenseDetail(businessId, expenseId);
  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  const result = await pool.query(
    "SELECT * FROM expenses WHERE id = $1 AND business_id = $2",
    [expenseId, businessId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Expense not found");
  }

  await setCache(cacheKey, result.rows[0], 60);
  res.status(200).json(result.rows[0]);
}
