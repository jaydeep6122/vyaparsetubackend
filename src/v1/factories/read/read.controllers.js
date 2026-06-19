import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function listFactories(req, res) {
  const userId = req.user.id;
  const result = await pool.query(
    `SELECT f.*, (SELECT COUNT(*) FROM workers w WHERE w.factory_id = f.id) AS worker_count
     FROM factories f
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC`,
    [userId]
  );
  res.status(200).json(result.rows);
}

export async function getFactoryById(req, res) {
  const { factoryId } = req.params;
  const result = await pool.query(
    `SELECT f.*, (SELECT COUNT(*) FROM workers w WHERE w.factory_id = f.id) AS worker_count
     FROM factories f
     WHERE f.id = $1`,
    [factoryId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Factory not found");
  }

  res.status(200).json(result.rows[0]);
}
