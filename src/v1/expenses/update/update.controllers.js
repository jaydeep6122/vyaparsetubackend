import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import { invalidateBusinessCache } from "../../../utils/cacheInvalidation.js";

export async function updateExpense(req, res) {
  const { businessId, expenseId } = req.params;
  const {
    expense_category,
    expense_number,
    expense_date,
    total_amount,
    paid_amount,
    payment_mode,
    description,
  } = req.body;

  if (expense_category === "") {
    throw new ApiError(400, "Expense category cannot be empty");
  }
  if (expense_number === "") {
    throw new ApiError(400, "Expense number cannot be empty");
  }

  if (payment_mode && !["cash", "bank", "upi", "credit"].includes(payment_mode)) {
    throw new ApiError(400, "Invalid payment_mode");
  }

  try {
    const query = `
      UPDATE expenses
      SET
        expense_category = COALESCE($1, expense_category),
        expense_number = COALESCE($2, expense_number),
        expense_date = COALESCE($3, expense_date),
        total_amount = COALESCE($4, total_amount),
        paid_amount = COALESCE($5, paid_amount),
        payment_mode = COALESCE($6, payment_mode),
        description = COALESCE($7, description),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 AND business_id = $9
      RETURNING *
    `;

    const values = [
      expense_category === undefined ? null : expense_category,
      expense_number === undefined ? null : expense_number,
      expense_date ? new Date(expense_date) : null,
      total_amount === undefined ? null : total_amount,
      paid_amount === undefined ? null : paid_amount,
      payment_mode === undefined ? null : payment_mode,
      description === undefined ? null : description,
      expenseId,
      businessId,
    ];

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      throw new ApiError(404, "Expense not found");
    }

    await invalidateBusinessCache(businessId);
    res.status(200).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new ApiError(400, `Expense number '${expense_number}' already exists in this business`);
    }
    throw error;
  }
}
