import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function createWorker(req, res) {
  const { factoryId } = req.params;
  const { name, type, rate_per_1000 } = req.body;

  const validTypes = ["producer_molder", "kiln_worker", "truck_worker"];
  if (!validTypes.includes(type)) {
    throw new ApiError(400, "Invalid worker type");
  }

  const query = `
    INSERT INTO workers (factory_id, name, type, rate_per_1000)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const values = [factoryId, name, type, rate_per_1000];

  try {
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new ApiError(400, "A worker with this name already exists in this factory");
    }
    throw error;
  }
}
