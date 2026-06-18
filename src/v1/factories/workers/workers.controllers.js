import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function createWorker(req, res) {
  const { factoryId } = req.params;
  const { name, phone, role, wage_type, base_rate, internal_loader_rate, is_active } = req.body;

  // Check for duplicates
  const dupCheck = await pool.query(
    "SELECT id FROM kiln_workers WHERE kiln_factory_id = $1 AND name = $2",
    [factoryId, name]
  );
  if (dupCheck.rowCount > 0) {
    throw new ApiError(400, `Worker named '${name}' already exists at this factory`);
  }

  const query = `
    INSERT INTO kiln_workers (
      kiln_factory_id, name, phone, role, wage_type, 
      base_rate, internal_loader_rate, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;
  const values = [
    factoryId,
    name,
    phone || null,
    role,
    wage_type,
    base_rate || 0,
    internal_loader_rate || 0,
    is_active !== undefined ? is_active : true
  ];

  const result = await pool.query(query, values);
  res.status(201).json(result.rows[0]);
}

export async function listWorkers(req, res) {
  const { factoryId } = req.params;
  const { role } = req.query;

  let query = "SELECT * FROM kiln_workers WHERE kiln_factory_id = $1";
  const values = [factoryId];

  if (role) {
    query += " AND role = $2";
    values.push(role);
  }

  query += " ORDER BY name ASC";

  const result = await pool.query(query, values);
  res.status(200).json(result.rows);
}

export async function getWorkerById(req, res) {
  const { factoryId, workerId } = req.params;

  const query = "SELECT * FROM kiln_workers WHERE id = $1 AND kiln_factory_id = $2";
  const result = await pool.query(query, [workerId, factoryId]);

  if (result.rowCount === 0) {
    throw new ApiError(404, "Worker not found");
  }

  res.status(200).json(result.rows[0]);
}

export async function updateWorker(req, res) {
  const { factoryId, workerId } = req.params;
  const { name, phone, role, wage_type, base_rate, internal_loader_rate, is_active } = req.body;

  // Verify worker exists
  const checkQuery = "SELECT id FROM kiln_workers WHERE id = $1 AND kiln_factory_id = $2";
  const checkRes = await pool.query(checkQuery, [workerId, factoryId]);
  if (checkRes.rowCount === 0) {
    throw new ApiError(404, "Worker not found");
  }

  // Check duplicate name if changing name
  if (name) {
    const dupCheck = await pool.query(
      "SELECT id FROM kiln_workers WHERE kiln_factory_id = $1 AND name = $2 AND id != $3",
      [factoryId, name, workerId]
    );
    if (dupCheck.rowCount > 0) {
      throw new ApiError(400, `Worker named '${name}' already exists at this factory`);
    }
  }

  // Get current worker values
  const currentRes = await pool.query("SELECT * FROM kiln_workers WHERE id = $1", [workerId]);
  const current = currentRes.rows[0];

  const query = `
    UPDATE kiln_workers
    SET 
      name = $1,
      phone = $2,
      role = $3,
      wage_type = $4,
      base_rate = $5,
      internal_loader_rate = $6,
      is_active = $7,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $8 AND kiln_factory_id = $9
    RETURNING *
  `;
  const values = [
    name !== undefined ? name : current.name,
    phone !== undefined ? phone : current.phone,
    role !== undefined ? role : current.role,
    wage_type !== undefined ? wage_type : current.wage_type,
    base_rate !== undefined ? base_rate : current.base_rate,
    internal_loader_rate !== undefined ? internal_loader_rate : current.internal_loader_rate,
    is_active !== undefined ? is_active : current.is_active,
    workerId,
    factoryId
  ];

  const result = await pool.query(query, values);
  res.status(200).json(result.rows[0]);
}

export async function deleteWorker(req, res) {
  const { factoryId, workerId } = req.params;

  // Verify worker exists and check balance
  const checkRes = await pool.query(
    "SELECT advance_balance FROM kiln_workers WHERE id = $1 AND kiln_factory_id = $2",
    [workerId, factoryId]
  );
  if (checkRes.rowCount === 0) {
    throw new ApiError(404, "Worker not found");
  }

  const advanceBalance = Number(checkRes.rows[0].advance_balance);
  if (advanceBalance > 0) {
    throw new ApiError(
      400,
      `Cannot delete worker. Worker has an outstanding advance balance of ₹${advanceBalance}`
    );
  }

  await pool.query("DELETE FROM kiln_workers WHERE id = $1 AND kiln_factory_id = $2", [workerId, factoryId]);
  res.status(200).json({ message: "Worker deleted successfully" });
}
