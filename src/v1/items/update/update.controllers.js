import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function updateItem(req, res) {
  const { businessId, itemId } = req.params;
  const {
    name,
    hsn_code,
    measuring_unit,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      "SELECT * FROM items WHERE id = $1 AND business_id = $2",
      [itemId, businessId]
    );
    if (existingResult.rowCount === 0) {
      throw new ApiError(404, "Item not found");
    }

    if (name === "") {
      throw new ApiError(400, "Name cannot be empty");
    }

    const query = `
      UPDATE items
      SET
        name = COALESCE($1, name),
        hsn_code = COALESCE($2, hsn_code),
        measuring_unit = COALESCE($3, measuring_unit),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 AND business_id = $5
      RETURNING *
    `;

    const values = [
      name === undefined ? null : name,
      hsn_code === undefined ? null : hsn_code,
      measuring_unit === undefined ? null : measuring_unit,
      itemId,
      businessId,
    ];

    const result = await client.query(query, values);
    await client.query("COMMIT");
    res.status(200).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new ApiError(400, "An item with this name already exists in this business");
    }
    throw error;
  } finally {
    client.release();
  }
}
