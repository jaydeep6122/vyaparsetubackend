import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function deleteExpense(req, res) {
  const { businessId, expenseId } = req.params;

  const result = await pool.query(
    "DELETE FROM expenses WHERE id = $1 AND business_id = $2 RETURNING id",
    [expenseId, businessId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Expense not found");
  }

  res.status(204).end();
}
