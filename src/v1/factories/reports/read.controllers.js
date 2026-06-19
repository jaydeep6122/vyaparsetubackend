import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function getWorkerSummary(req, res) {
  const { factoryId, workerId } = req.params;
  const { from_date, to_date } = req.query;

  const workerResult = await pool.query(
    `SELECT *,
      (total_amount - total_money_given) AS balance_due
     FROM workers
     WHERE id = $1 AND factory_id = $2`,
    [workerId, factoryId]
  );

  if (workerResult.rowCount === 0) {
    throw new ApiError(404, "Worker not found");
  }

  const worker = workerResult.rows[0];

  let moneyQuery = `
    SELECT date, amount, notes
    FROM transaction_logs
    WHERE factory_id = $1 AND worker_id = $2 AND type = 'money_given'
  `;
  const moneyValues = [factoryId, workerId];

  if (from_date) {
    moneyValues.push(from_date);
    moneyQuery += ` AND date >= $${moneyValues.length}`;
  }
  if (to_date) {
    moneyValues.push(to_date);
    moneyQuery += ` AND date <= $${moneyValues.length}`;
  }

  moneyQuery += " ORDER BY date ASC";
  const moneyResult = await pool.query(moneyQuery, moneyValues);

  const totalMoneyGiven = Number(worker.total_money_given);
  const totalAmount = Number(worker.total_amount);
  const totalBricks = Number(worker.total_bricks);
  const balanceDue = totalAmount - totalMoneyGiven;

  res.status(200).json({
    worker_id: worker.id,
    name: worker.name,
    type: worker.type,
    rate_per_1000: Number(worker.rate_per_1000),
    period: {
      from: from_date || null,
      to: to_date || null,
    },
    wages: {
      total_bricks: totalBricks,
      total_amount: totalAmount,
    },
    money: {
      total_given: totalMoneyGiven,
      transactions: moneyResult.rows,
    },
    balance_due: balanceDue,
  });
}

export async function getFactorySummary(req, res) {
  const { factoryId } = req.params;
  const { from_date, to_date } = req.query;

  let filterClause = "";
  const filterValues = [];

  if (from_date) {
    filterValues.push(from_date);
    filterClause += ` AND t.date >= $${filterValues.length + 1}`;
  }
  if (to_date) {
    filterValues.push(to_date);
    filterClause += ` AND t.date <= $${filterValues.length + 1}`;
  }

  const wageTotalsQuery = `
    SELECT
      COALESCE(SUM(CASE WHEN t.is_in != FALSE THEN t.quantity ELSE 0 END), 0) AS total_bricks_produced,
      COALESCE(SUM(t.amount), 0) AS total_amount_owed
    FROM transaction_logs t
    WHERE t.factory_id = $1 AND t.type != 'money_given'${filterClause}
  `;
  const wageValues = [factoryId, ...filterValues];
  const wageResult = await pool.query(wageTotalsQuery, wageValues);

  const moneyGivenQuery = `
    SELECT COALESCE(SUM(t.amount), 0) AS total_money_given
    FROM transaction_logs t
    WHERE t.factory_id = $1 AND t.type = 'money_given'${filterClause}
  `;
  const moneyValues = [factoryId, ...filterValues];
  const moneyResult = await pool.query(moneyGivenQuery, moneyValues);

  const workersQuery = `
    SELECT
      id AS worker_id,
      name,
      type,
      total_bricks,
      total_amount,
      total_money_given,
      (total_amount - total_money_given) AS balance_due
    FROM workers
    WHERE factory_id = $1
    ORDER BY name ASC
  `;
  const workersResult = await pool.query(workersQuery, [factoryId]);

  res.status(200).json({
    factory_id: factoryId,
    period: {
      from: from_date || null,
      to: to_date || null,
    },
    total_bricks_produced: Number(wageResult.rows[0].total_bricks_produced),
    total_amount_owed: Number(wageResult.rows[0].total_amount_owed),
    total_money_given: Number(moneyResult.rows[0].total_money_given),
    workers_summary: workersResult.rows,
  });
}
