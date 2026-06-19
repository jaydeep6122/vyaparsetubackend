import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function listWorkers(req, res) {
  const { factoryId } = req.params;
  const { type, status } = req.query;

  let query = `
    SELECT *,
      (total_amount - total_money_given) AS balance_due
    FROM workers
    WHERE factory_id = $1
  `;
  const values = [factoryId];
  let paramIndex = 2;

  if (type) {
    query += ` AND type = $${paramIndex}`;
    values.push(type);
    paramIndex++;
  }

  if (status) {
    query += ` AND status = $${paramIndex}`;
    values.push(status);
    paramIndex++;
  }

  query += " ORDER BY name ASC";

  const result = await pool.query(query, values);
  res.status(200).json(result.rows);
}

export async function getWorkerById(req, res) {
  const { factoryId, workerId } = req.params;

  const result = await pool.query(
    `SELECT *,
      (total_amount - total_money_given) AS balance_due
     FROM workers
     WHERE id = $1 AND factory_id = $2`,
    [workerId, factoryId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Worker not found");
  }

  res.status(200).json(result.rows[0]);
}
