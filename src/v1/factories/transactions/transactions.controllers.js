import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function createTransaction(req, res) {
  const { factoryId } = req.params;
  const { worker_id, date, transaction_type, amount, payment_mode, reference_number, description } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Fetch and lock worker record
    const workerRes = await client.query(
      "SELECT * FROM kiln_workers WHERE id = $1 AND kiln_factory_id = $2 FOR UPDATE",
      [worker_id, factoryId]
    );

    if (workerRes.rowCount === 0) {
      throw new ApiError(404, "Worker not found at this factory");
    }

    const worker = workerRes.rows[0];

    // Insert transaction record
    const insertQuery = `
      INSERT INTO kiln_transactions (
        kiln_factory_id, worker_id, date, transaction_type, amount, 
        payment_mode, reference_number, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const insertValues = [
      factoryId,
      worker_id,
      date ? new Date(date) : new Date(),
      transaction_type,
      amount,
      payment_mode,
      reference_number || null,
      description || null
    ];

    const result = await client.query(insertQuery, insertValues);
    const savedTransaction = result.rows[0];

    // Update worker's running balances
    if (transaction_type === "peshgi") {
      await client.query(
        "UPDATE kiln_workers SET advance_balance = round(advance_balance + $1, 2) WHERE id = $2",
        [amount, worker_id]
      );
    } else if (transaction_type === "khoraki") {
      await client.query(
        "UPDATE kiln_workers SET unsettled_khoraki = round(unsettled_khoraki + $1, 2) WHERE id = $2",
        [amount, worker_id]
      );
    } else if (transaction_type === "extra_deduction") {
      // General deduct increases current pending weekly deductions (stored in unsettled_khoraki for simplicity)
      await client.query(
        "UPDATE kiln_workers SET unsettled_khoraki = round(unsettled_khoraki + $1, 2) WHERE id = $2",
        [amount, worker_id]
      );
    } else if (transaction_type === "manual_payout") {
      // Manual wage payment clears unsettled earnings directly
      await client.query(
        "UPDATE kiln_workers SET unsettled_earnings = round(unsettled_earnings - $1, 2) WHERE id = $2",
        [amount, worker_id]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(savedTransaction);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listTransactions(req, res) {
  const { factoryId } = req.params;
  const { worker_id, transaction_type, start_date, end_date } = req.query;

  let query = `
    SELECT kt.*, kw.name as worker_name 
    FROM kiln_transactions kt
    JOIN kiln_workers kw ON kt.worker_id = kw.id
    WHERE kt.kiln_factory_id = $1
  `;
  const values = [factoryId];
  let valIndex = 2;

  if (worker_id) {
    query += ` AND kt.worker_id = $${valIndex}`;
    values.push(worker_id);
    valIndex++;
  }

  if (transaction_type) {
    query += ` AND kt.transaction_type = $${valIndex}`;
    values.push(transaction_type);
    valIndex++;
  }

  if (start_date) {
    query += ` AND kt.date >= $${valIndex}`;
    values.push(new Date(start_date));
    valIndex++;
  }

  if (end_date) {
    query += ` AND kt.date <= $${valIndex}`;
    values.push(new Date(end_date));
    valIndex++;
  }

  query += " ORDER BY kt.date DESC, kt.created_at DESC";

  const result = await pool.query(query, values);
  res.status(200).json(result.rows);
}
