import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function createHandoffService({ factoryId, kilnWorkerId, producerMolderId, quantity, date, notes }) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const kilnWorker = await client.query(
      "SELECT id, rate_per_1000 FROM workers WHERE id = $1 AND factory_id = $2 AND type = 'kiln_worker'",
      [kilnWorkerId, factoryId]
    );
    if (kilnWorker.rowCount === 0) {
      throw new ApiError(404, "Kiln worker not found in this factory");
    }

    const producerMolder = await client.query(
      "SELECT id, rate_per_1000 FROM workers WHERE id = $1 AND factory_id = $2 AND type = 'producer_molder'",
      [producerMolderId, factoryId]
    );
    if (producerMolder.rowCount === 0) {
      throw new ApiError(404, "Producer molder not found in this factory");
    }

    const kilnAmount = Math.round(quantity * (Number(kilnWorker.rows[0].rate_per_1000) / 1000) * 100) / 100;
    const producerAmount = Math.round(quantity * (Number(producerMolder.rows[0].rate_per_1000) / 1000) * 100) / 100;

    const transactionResult = await client.query(
      `INSERT INTO transaction_logs (factory_id, type, kiln_worker_id, producer_molder_id, quantity, amount, date, notes)
       VALUES ($1, 'handoff', $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [factoryId, kilnWorkerId, producerMolderId, quantity, kilnAmount + producerAmount, date, notes || null]
    );

    await client.query(
      `UPDATE workers SET
        total_bricks = total_bricks + $1,
        total_amount = total_amount + $2,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [quantity, kilnAmount, kilnWorkerId]
    );

    await client.query(
      `UPDATE workers SET
        total_bricks = total_bricks + $1,
        total_amount = total_amount + $2,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [quantity, producerAmount, producerMolderId]
    );

    await client.query("COMMIT");

    const updatedKiln = await pool.query(
      "SELECT id, total_bricks, total_amount FROM workers WHERE id = $1",
      [kilnWorkerId]
    );
    const updatedProducer = await pool.query(
      "SELECT id, total_bricks, total_amount FROM workers WHERE id = $1",
      [producerMolderId]
    );

    return {
      transaction: transactionResult.rows[0],
      updates: {
        kiln_worker: updatedKiln.rows[0],
        producer_molder: updatedProducer.rows[0],
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createDirectService({ factoryId, workerId, quantity, amount, date, notes }) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const worker = await client.query(
      "SELECT id, rate_per_1000 FROM workers WHERE id = $1 AND factory_id = $2",
      [workerId, factoryId]
    );
    if (worker.rowCount === 0) {
      throw new ApiError(404, "Worker not found in this factory");
    }

    let finalAmount;
    let finalQuantity;

    if (amount !== undefined && amount !== null) {
      finalAmount = amount;
      finalQuantity = null;
    } else {
      finalAmount = Math.round(quantity * (Number(worker.rows[0].rate_per_1000) / 1000) * 100) / 100;
      finalQuantity = quantity;
    }

    const transactionResult = await client.query(
      `INSERT INTO transaction_logs (factory_id, type, worker_id, quantity, amount, date, notes)
       VALUES ($1, 'direct', $2, $3, $4, $5, $6)
       RETURNING *`,
      [factoryId, workerId, finalQuantity, finalAmount, date, notes || null]
    );

    await client.query(
      `UPDATE workers SET
        total_bricks = total_bricks + $1,
        total_amount = total_amount + $2,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [finalQuantity || 0, finalAmount, workerId]
    );

    await client.query("COMMIT");

    const updatedWorker = await pool.query(
      "SELECT id, total_bricks, total_amount FROM workers WHERE id = $1",
      [workerId]
    );

    return {
      transaction: transactionResult.rows[0],
      updates: updatedWorker.rows[0],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createTruckDistService({ factoryId, truckWorkerIds, totalQuantity, date, notes }) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const wid of truckWorkerIds) {
      const exists = await client.query(
        "SELECT id FROM workers WHERE id = $1 AND factory_id = $2 AND type = 'truck_worker'",
        [wid, factoryId]
      );
      if (exists.rowCount === 0) {
        throw new ApiError(404, `Truck worker ${wid} not found in this factory`);
      }
    }

    const workers = await client.query(
      "SELECT id, rate_per_1000 FROM workers WHERE id = ANY($1::uuid[])",
      [truckWorkerIds]
    );

    const perWorkerQuantity = Math.floor(totalQuantity / truckWorkerIds.length);

    const transactionResult = await client.query(
      `INSERT INTO transaction_logs (factory_id, type, truck_worker_ids, quantity, date, notes)
       VALUES ($1, 'truck_dist', $2, $3, $4, $5)
       RETURNING *`,
      [factoryId, JSON.stringify(truckWorkerIds), totalQuantity, date, notes || null]
    );

    const updates = [];
    for (const worker of workers.rows) {
      const amount = Math.round(perWorkerQuantity * (Number(worker.rate_per_1000) / 1000) * 100) / 100;

      await client.query(
        `UPDATE workers SET
          total_bricks = total_bricks + $1,
          total_amount = total_amount + $2,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [perWorkerQuantity, amount, worker.id]
      );

      updates.push({ worker_id: worker.id, total_bricks: perWorkerQuantity, total_amount: amount });
    }

    await client.query("COMMIT");

    const fullUpdates = [];
    for (const upd of updates) {
      const result = await pool.query(
        "SELECT id, total_bricks, total_amount FROM workers WHERE id = $1",
        [upd.worker_id]
      );
      fullUpdates.push(result.rows[0]);
    }

    return {
      transaction: transactionResult.rows[0],
      per_worker_quantity: perWorkerQuantity,
      updates: fullUpdates,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createMoneyGivenService({ factoryId, workerId, amount, date, notes }) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const worker = await client.query(
      "SELECT id FROM workers WHERE id = $1 AND factory_id = $2",
      [workerId, factoryId]
    );
    if (worker.rowCount === 0) {
      throw new ApiError(404, "Worker not found in this factory");
    }

    const transactionResult = await client.query(
      `INSERT INTO transaction_logs (factory_id, type, worker_id, amount, date, notes)
       VALUES ($1, 'money_given', $2, $3, $4, $5)
       RETURNING *`,
      [factoryId, workerId, amount, date, notes || null]
    );

    await client.query(
      `UPDATE workers SET
        total_money_given = total_money_given + $1,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [amount, workerId]
    );

    await client.query("COMMIT");

    const updatedWorker = await pool.query(
      "SELECT id, total_money_given, (total_amount - total_money_given) AS balance_due FROM workers WHERE id = $1",
      [workerId]
    );

    return {
      transaction: transactionResult.rows[0],
      updates: updatedWorker.rows[0],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
