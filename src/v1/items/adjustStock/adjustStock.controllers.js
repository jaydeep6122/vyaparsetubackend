import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function adjustStock(req, res) {
  const { businessId, itemId } = req.params;
  const { quantity, type, notes } = req.body;

  if (!quantity || !type) {
    throw new ApiError(400, "Quantity and type are required");
  }

  if (Number(quantity) <= 0) {
    throw new ApiError(400, "Quantity must be a positive number");
  }

  if (!["adjustment_add", "adjustment_reduce"].includes(type)) {
    throw new ApiError(400, "Invalid adjustment type. Must be adjustment_add or adjustment_reduce");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const itemResult = await client.query(
      "SELECT * FROM items WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [itemId, businessId]
    );

    if (itemResult.rowCount === 0) {
      throw new ApiError(404, "Item not found");
    }

    const item = itemResult.rows[0];

    if (item.item_type !== "product") {
      throw new ApiError(400, "Stock adjustments can only be applied to product type items");
    }

    const adjustmentValue = Number(quantity);
    const newStock = type === "adjustment_add" 
      ? Number(item.current_stock) + adjustmentValue
      : Number(item.current_stock) - adjustmentValue;

    if (newStock < 0) {
      throw new ApiError(400, `Insufficient stock. Current stock is ${item.current_stock}`);
    }

    const updateResult = await client.query(
      "UPDATE items SET current_stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
      [newStock, itemId]
    );

    await client.query(
      `INSERT INTO stock_transactions (
        business_id, item_id, transaction_type, quantity, notes
       ) VALUES ($1, $2, $3, $4, $5)`,
      [businessId, itemId, type, adjustmentValue, notes || "Manual stock adjustment"]
    );

    await client.query("COMMIT");
    res.status(200).json(updateResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
