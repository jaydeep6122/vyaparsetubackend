import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function listItems(req, res) {
  const { businessId } = req.params;
  const { search } = req.query;

  let query = "SELECT * FROM items WHERE business_id = $1";
  const values = [businessId];
  let paramIndex = 2;

  if (search) {
    query += ` AND name ILIKE $${paramIndex}`;
    values.push(`%${search}%`);
    paramIndex++;
  }

  query += " ORDER BY name ASC";

  const result = await pool.query(query, values);
  res.status(200).json(result.rows);
}

export async function getItemById(req, res) {
  const { businessId, itemId } = req.params;
  const result = await pool.query(
    "SELECT * FROM items WHERE id = $1 AND business_id = $2",
    [itemId, businessId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Item not found");
  }

  res.status(200).json(result.rows[0]);
}
