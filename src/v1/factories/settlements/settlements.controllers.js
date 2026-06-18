import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function previewSettlement(req, res) {
  const { factoryId, workerId } = req.params;
  const { start_date, end_date } = req.query;

  // 1. Fetch worker
  const workerRes = await pool.query(
    "SELECT * FROM kiln_workers WHERE id = $1 AND kiln_factory_id = $2",
    [workerId, factoryId]
  );
  if (workerRes.rowCount === 0) {
    throw new ApiError(404, "Worker not found");
  }
  const worker = workerRes.rows[0];

  // 2. Fetch unsettled earnings in date range
  let earningsQuery = `
    SELECT 
      id, date, operation_type, quantity,
      earnings_type1, earnings_type2, earnings_type3,
      type1_worker_id, type2_worker_id, type3_worker_id
    FROM kiln_work_logs
    WHERE kiln_factory_id = $1 AND is_settled = false
      AND (type1_worker_id = $2 OR type2_worker_id = $2 OR type3_worker_id = $2)
  `;
  const earningsValues = [factoryId, workerId];
  let valIndex = 3;

  if (start_date) {
    earningsQuery += ` AND date >= $${valIndex}`;
    earningsValues.push(new Date(start_date));
    valIndex++;
  }
  if (end_date) {
    earningsQuery += ` AND date <= $${valIndex}`;
    earningsValues.push(new Date(end_date));
    valIndex++;
  }

  const workLogsRes = await pool.query(earningsQuery, earningsValues);
  
  let grossEarnings = 0;
  for (const log of workLogsRes.rows) {
    if (log.type1_worker_id === workerId) {
      grossEarnings += Number(log.earnings_type1);
    }
    if (log.type2_worker_id === workerId) {
      grossEarnings += Number(log.earnings_type2);
    }
    if (log.type3_worker_id === workerId) {
      grossEarnings += Number(log.earnings_type3);
    }
  }
  grossEarnings = round2(grossEarnings);

  // 3. Fetch unsettled khoraki (grocery allowance) & deductions in date range
  let txQuery = `
    SELECT id, date, amount, transaction_type
    FROM kiln_transactions
    WHERE kiln_factory_id = $1 AND worker_id = $2 AND is_settled = false
      AND transaction_type IN ('khoraki', 'extra_deduction')
  `;
  const txValues = [factoryId, workerId];
  let txIndex = 3;

  if (start_date) {
    txQuery += ` AND date >= $${txIndex}`;
    txValues.push(new Date(start_date));
    txIndex++;
  }
  if (end_date) {
    txQuery += ` AND date <= $${txIndex}`;
    txValues.push(new Date(end_date));
    txIndex++;
  }

  const txRes = await pool.query(txQuery, txValues);

  let khorakiDeducted = 0;
  for (const tx of txRes.rows) {
    khorakiDeducted += Number(tx.amount);
  }
  khorakiDeducted = round2(khorakiDeducted);

  const suggestedNetPayout = round2(Math.max(0, grossEarnings - khorakiDeducted));

  res.status(200).json({
    worker_id: workerId,
    worker_name: worker.name,
    role: worker.role,
    advance_balance: Number(worker.advance_balance),
    gross_earnings: grossEarnings,
    khoraki_deducted: khorakiDeducted,
    suggested_net_payout: suggestedNetPayout,
    unsettled_work_logs_count: workLogsRes.rowCount,
    unsettled_transactions_count: txRes.rowCount
  });
}

export async function createSettlement(req, res) {
  const { factoryId } = req.params;
  const {
    worker_id,
    settlement_date,
    start_date,
    end_date,
    gross_earnings,
    khoraki_deducted,
    peshgi_recovered,
    net_payout,
    payment_mode,
    reference_number,
    notes
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Fetch and lock worker record
    const workerRes = await client.query(
      "SELECT * FROM kiln_workers WHERE id = $1 AND kiln_factory_id = $2 FOR UPDATE",
      [worker_id, factoryId]
    );
    if (workerRes.rowCount === 0) {
      throw new ApiError(404, "Worker not found at this factory");
    }

    const worker = workerRes.rows[0];

    // Ensure they have enough advance balance to recover from
    if (Number(peshgi_recovered) > Number(worker.advance_balance)) {
      throw new ApiError(
        400,
        `Cannot recover ₹${peshgi_recovered} Peshgi. Worker outstanding advance balance is only ₹${worker.advance_balance}`
      );
    }

    // 2. Insert settlement record
    const insertQuery = `
      INSERT INTO kiln_settlements (
        kiln_factory_id, worker_id, settlement_date, start_date, end_date,
        gross_earnings, khoraki_deducted, peshgi_recovered, net_payout,
        payment_mode, reference_number, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;
    const insertValues = [
      factoryId,
      worker_id,
      settlement_date ? new Date(settlement_date) : new Date(),
      new Date(start_date),
      new Date(end_date),
      gross_earnings,
      khoraki_deducted,
      peshgi_recovered,
      net_payout,
      payment_mode,
      reference_number || null,
      notes || null
    ];

    const settlementResult = await client.query(insertQuery, insertValues);
    const savedSettlement = settlementResult.rows[0];

    // 3. Mark matching work logs as settled
    await client.query(
      `
      UPDATE kiln_work_logs
      SET is_settled = true, settlement_id = $1
      WHERE kiln_factory_id = $2 AND is_settled = false
        AND (type1_worker_id = $3 OR type2_worker_id = $3 OR type3_worker_id = $3)
        AND date >= $4 AND date <= $5
      `,
      [savedSettlement.id, factoryId, worker_id, new Date(start_date), new Date(end_date)]
    );

    // 4. Mark matching khoraki / extra deductions as settled
    await client.query(
      `
      UPDATE kiln_transactions
      SET is_settled = true, settlement_id = $1
      WHERE kiln_factory_id = $2 AND worker_id = $3 AND is_settled = false
        AND transaction_type IN ('khoraki', 'extra_deduction')
        AND date >= $4 AND date <= $5
      `,
      [savedSettlement.id, factoryId, worker_id, new Date(start_date), new Date(end_date)]
    );

    // 5. Update running worker balances
    // - Subtract gross earnings from unsettled_earnings
    // - Subtract khoraki_deducted from unsettled_khoraki
    // - Subtract peshgi_recovered from advance_balance
    await client.query(
      `
      UPDATE kiln_workers
      SET 
        unsettled_earnings = round(unsettled_earnings - $1, 2),
        unsettled_khoraki = round(unsettled_khoraki - $2, 2),
        advance_balance = round(advance_balance - $3, 2),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      `,
      [gross_earnings, khoraki_deducted, peshgi_recovered, worker_id]
    );

    await client.query("COMMIT");
    res.status(201).json(savedSettlement);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listSettlements(req, res) {
  const { factoryId } = req.params;
  const { worker_id } = req.query;

  let query = `
    SELECT ks.*, kw.name as worker_name, kw.role
    FROM kiln_settlements ks
    JOIN kiln_workers kw ON ks.worker_id = kw.id
    WHERE ks.kiln_factory_id = $1
  `;
  const values = [factoryId];

  if (worker_id) {
    query += " AND ks.worker_id = $2";
    values.push(worker_id);
  }

  query += " ORDER BY ks.settlement_date DESC, ks.created_at DESC";

  const result = await pool.query(query, values);
  res.status(200).json(result.rows);
}
