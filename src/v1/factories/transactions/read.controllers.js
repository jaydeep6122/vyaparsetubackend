import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function listTransactions(req, res) {
  const { factoryId } = req.params;
  const { type, worker_id, date_from, date_to } = req.query;

  let query = "SELECT * FROM transaction_logs WHERE factory_id = $1";
  const values = [factoryId];
  let paramIndex = 2;

  if (type) {
    query += ` AND type = $${paramIndex}`;
    values.push(type);
    paramIndex++;
  }

  if (worker_id) {
    query += ` AND (worker_id = $${paramIndex} OR kiln_worker_id = $${paramIndex} OR producer_molder_id = $${paramIndex} OR truck_worker_ids @> to_jsonb($${paramIndex}::text))`;
    values.push(worker_id);
    paramIndex++;
  }

  if (date_from) {
    query += ` AND date >= $${paramIndex}`;
    values.push(date_from);
    paramIndex++;
  }

  if (date_to) {
    query += ` AND date <= $${paramIndex}`;
    values.push(date_to);
    paramIndex++;
  }

  query += " ORDER BY date DESC, created_at DESC";

  const result = await pool.query(query, values);
  res.status(200).json(result.rows);
}

export async function getTransactionById(req, res) {
  const { factoryId, transactionId } = req.params;

  const result = await pool.query(
    "SELECT * FROM transaction_logs WHERE id = $1 AND factory_id = $2",
    [transactionId, factoryId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Transaction not found");
  }

  res.status(200).json(result.rows[0]);
}

export async function getWorkerTransactions(req, res) {
  const { factoryId, workerId } = req.params;
  const { type, date_from, date_to } = req.query;

  let query = `
    SELECT * FROM transaction_logs
    WHERE factory_id = $1
      AND (worker_id = $2 OR kiln_worker_id = $2 OR producer_molder_id = $2 OR truck_worker_ids @> to_jsonb($2::text))
  `;
  const values = [factoryId, workerId];
  let paramIndex = 3;

  if (type) {
    query += ` AND type = $${paramIndex}`;
    values.push(type);
    paramIndex++;
  }

  if (date_from) {
    query += ` AND date >= $${paramIndex}`;
    values.push(date_from);
    paramIndex++;
  }

  if (date_to) {
    query += ` AND date <= $${paramIndex}`;
    values.push(date_to);
    paramIndex++;
  }

  query += " ORDER BY date DESC, created_at DESC";

  const result = await pool.query(query, values);
  res.status(200).json(result.rows);
}
