import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function createWorkLog(req, res) {
  const { factoryId } = req.params;
  const { date, type1_worker_id, type2_worker_id, type3_worker_id, operation_type, quantity } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Initialize rates and calculated earnings
    let rate1 = 0, rate2 = 0, rate3 = 0;
    let earnings1 = 0, earnings2 = 0, earnings3 = 0;

    // Fetch and validate Type 1 (Moulder) if present
    if (type1_worker_id) {
      const workerRes = await client.query(
        "SELECT * FROM kiln_workers WHERE id = $1 AND kiln_factory_id = $2 FOR UPDATE",
        [type1_worker_id, factoryId]
      );
      if (workerRes.rowCount === 0) {
        throw new ApiError(404, "Moulder (Type 1 worker) not found at this factory");
      }
      rate1 = Number(workerRes.rows[0].base_rate);
      earnings1 = round2((quantity / 1000) * rate1);
    }

    // Fetch and validate Type 2 (Stacker) if present
    if (type2_worker_id) {
      const workerRes = await client.query(
        "SELECT * FROM kiln_workers WHERE id = $1 AND kiln_factory_id = $2 FOR UPDATE",
        [type2_worker_id, factoryId]
      );
      if (workerRes.rowCount === 0) {
        throw new ApiError(404, "Stacker (Type 2 worker) not found at this factory");
      }
      rate2 = Number(workerRes.rows[0].base_rate);
      earnings2 = round2((quantity / 1000) * rate2);
    }

    // Fetch and validate Type 3 (Loader) if present
    if (type3_worker_id) {
      const workerRes = await client.query(
        "SELECT * FROM kiln_workers WHERE id = $1 AND kiln_factory_id = $2 FOR UPDATE",
        [type3_worker_id, factoryId]
      );
      if (workerRes.rowCount === 0) {
        throw new ApiError(404, "Loader (Type 3 worker) not found at this factory");
      }
      const worker = workerRes.rows[0];
      // Select internal rate if shifting internally, otherwise base rate
      rate3 = operation_type === "load_internal" ? Number(worker.internal_loader_rate) : Number(worker.base_rate);
      earnings3 = round2((quantity / 1000) * rate3);
    }

    // Insert log record
    const insertQuery = `
      INSERT INTO kiln_work_logs (
        kiln_factory_id, date, type1_worker_id, type2_worker_id, type3_worker_id,
        operation_type, quantity, rate_applied_type1, rate_applied_type2, rate_applied_type3,
        earnings_type1, earnings_type2, earnings_type3
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;
    const insertValues = [
      factoryId,
      date ? new Date(date) : new Date(),
      type1_worker_id || null,
      type2_worker_id || null,
      type3_worker_id || null,
      operation_type,
      quantity,
      rate1,
      rate2,
      rate3,
      earnings1,
      earnings2,
      earnings3
    ];

    const result = await client.query(insertQuery, insertValues);
    const savedLog = result.rows[0];

    // Update running unsettled earnings for workers
    if (type1_worker_id && earnings1 > 0) {
      await client.query(
        "UPDATE kiln_workers SET unsettled_earnings = round(unsettled_earnings + $1, 2) WHERE id = $2",
        [earnings1, type1_worker_id]
      );
    }
    if (type2_worker_id && earnings2 > 0) {
      await client.query(
        "UPDATE kiln_workers SET unsettled_earnings = round(unsettled_earnings + $1, 2) WHERE id = $2",
        [earnings2, type2_worker_id]
      );
    }
    if (type3_worker_id && earnings3 > 0) {
      await client.query(
        "UPDATE kiln_workers SET unsettled_earnings = round(unsettled_earnings + $1, 2) WHERE id = $2",
        [earnings3, type3_worker_id]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(savedLog);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listWorkLogs(req, res) {
  const { factoryId } = req.params;
  const { worker_id, start_date, end_date, operation_type } = req.query;

  let query = `
    SELECT wl.*,
      w1.name as type1_worker_name,
      w2.name as type2_worker_name,
      w3.name as type3_worker_name
    FROM kiln_work_logs wl
    LEFT JOIN kiln_workers w1 ON wl.type1_worker_id = w1.id
    LEFT JOIN kiln_workers w2 ON wl.type2_worker_id = w2.id
    LEFT JOIN kiln_workers w3 ON wl.type3_worker_id = w3.id
    WHERE wl.kiln_factory_id = $1
  `;
  const values = [factoryId];
  let valIndex = 2;

  if (worker_id) {
    query += ` AND (wl.type1_worker_id = $${valIndex} OR wl.type2_worker_id = $${valIndex} OR wl.type3_worker_id = $${valIndex})`;
    values.push(worker_id);
    valIndex++;
  }

  if (operation_type) {
    query += ` AND wl.operation_type = $${valIndex}`;
    values.push(operation_type);
    valIndex++;
  }

  if (start_date) {
    query += ` AND wl.date >= $${valIndex}`;
    values.push(new Date(start_date));
    valIndex++;
  }

  if (end_date) {
    query += ` AND wl.date <= $${valIndex}`;
    values.push(new Date(end_date));
    valIndex++;
  }

  query += " ORDER BY wl.date DESC, wl.created_at DESC";

  const result = await pool.query(query, values);
  res.status(200).json(result.rows);
}

export async function deleteWorkLog(req, res) {
  const { factoryId, logId } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Fetch and lock the log record
    const logRes = await client.query(
      "SELECT * FROM kiln_work_logs WHERE id = $1 AND kiln_factory_id = $2 FOR UPDATE",
      [logId, factoryId]
    );

    if (logRes.rowCount === 0) {
      throw new ApiError(404, "Work log not found");
    }

    const log = logRes.rows[0];

    // Check if already settled
    if (log.is_settled) {
      throw new ApiError(400, "Cannot delete work log. It has already been settled in a Hisaab settlement");
    }

    // Deduct the credited earnings from workers' unsettled balances
    if (log.type1_worker_id && Number(log.earnings_type1) > 0) {
      await client.query(
        "UPDATE kiln_workers SET unsettled_earnings = round(unsettled_earnings - $1, 2) WHERE id = $2",
        [Number(log.earnings_type1), log.type1_worker_id]
      );
    }
    if (log.type2_worker_id && Number(log.earnings_type2) > 0) {
      await client.query(
        "UPDATE kiln_workers SET unsettled_earnings = round(unsettled_earnings - $1, 2) WHERE id = $2",
        [Number(log.earnings_type2), log.type2_worker_id]
      );
    }
    if (log.type3_worker_id && Number(log.earnings_type3) > 0) {
      await client.query(
        "UPDATE kiln_workers SET unsettled_earnings = round(unsettled_earnings - $1, 2) WHERE id = $2",
        [Number(log.earnings_type3), log.type3_worker_id]
      );
    }

    // Delete log record
    await client.query("DELETE FROM kiln_work_logs WHERE id = $1", [logId]);

    await client.query("COMMIT");
    res.status(200).json({ message: "Work log deleted successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
