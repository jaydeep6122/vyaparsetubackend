import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function deleteWorker(req, res) {
  const { factoryId, workerId } = req.params;

  const result = await pool.query(
    "DELETE FROM workers WHERE id = $1 AND factory_id = $2 RETURNING id",
    [workerId, factoryId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Worker not found");
  }

  res.status(204).end();
}
