import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function updateWorker(req, res) {
  const { factoryId, workerId } = req.params;
  const { name, rate_per_1000, status } = req.body;

  if (name === "") {
    throw new ApiError(400, "Name cannot be empty");
  }

  if (status && !["active", "inactive"].includes(status)) {
    throw new ApiError(400, "Status must be 'active' or 'inactive'");
  }

  const query = `
    UPDATE workers
    SET
      name = COALESCE($1, name),
      rate_per_1000 = COALESCE($2, rate_per_1000),
      status = COALESCE($3, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $4 AND factory_id = $5
    RETURNING *
  `;
  const values = [
    name === undefined ? null : name,
    rate_per_1000 === undefined ? null : rate_per_1000,
    status === undefined ? null : status,
    workerId,
    factoryId,
  ];

  const result = await pool.query(query, values);

  if (result.rowCount === 0) {
    throw new ApiError(404, "Worker not found");
  }

  res.status(200).json(result.rows[0]);
}
