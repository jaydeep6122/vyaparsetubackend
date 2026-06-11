import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function createExpense(req, res) {
  const { businessId } = req.params;
  const {
    expense_category,
    expense_number,
    expense_date,
    total_amount,
    paid_amount = 0,
    payment_mode,
    description,
  } = req.body;

  if (!expense_category || !expense_number || !total_amount || !payment_mode) {
    throw new ApiError(
      400,
      "expense_category, expense_number, total_amount, and payment_mode are required"
    );
  }

  const validPaymentModes = ["cash", "bank", "upi", "credit"];
  if (!validPaymentModes.includes(payment_mode)) {
    throw new ApiError(400, "Invalid payment_mode. Must be cash, bank, upi, or credit");
  }

  if (Number(total_amount) < 0) {
    throw new ApiError(400, "Total amount cannot be negative");
  }

  try {
    const query = `
      INSERT INTO expenses (
        business_id, expense_category, expense_number, expense_date, 
        total_amount, paid_amount, payment_mode, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const values = [
      businessId,
      expense_category,
      expense_number,
      expense_date ? new Date(expense_date) : new Date(),
      total_amount,
      paid_amount,
      payment_mode,
      description || null,
    ];

    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new ApiError(400, `Expense number '${expense_number}' already exists in this business`);
    }
    throw error;
  }
}
