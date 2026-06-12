import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import { invalidateBusinessCache } from "../../../utils/cacheInvalidation.js";

export async function createItem(req, res) {
  const { businessId } = req.params;
  const {
    name,
    hsn_code,
    measuring_unit = "pcs",
  } = req.body;

  if (!name) {
    throw new ApiError(400, "Name is required");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const query = `
      INSERT INTO items (
        business_id, name, hsn_code, measuring_unit
      ) VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const values = [
      businessId,
      name,
      hsn_code || null,
      measuring_unit,
    ];

    const result = await client.query(query, values);
    const item = result.rows[0];

    await client.query("COMMIT");
    await invalidateBusinessCache(businessId);
    res.status(201).json(item);
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
