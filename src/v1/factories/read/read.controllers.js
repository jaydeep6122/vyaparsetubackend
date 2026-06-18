import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function listFactories(req, res) {
  const userId = req.user.id;
  const result = await pool.query(
    "SELECT * FROM kiln_factories WHERE user_id = $1 ORDER BY name ASC",
    [userId]
  );
  res.status(200).json(result.rows);
}

export async function getFactoryById(req, res) {
  const { factoryId } = req.params;

  // Get factory basic details
  const factoryRes = await pool.query(
    "SELECT * FROM kiln_factories WHERE id = $1",
    [factoryId]
  );
  if (factoryRes.rowCount === 0) {
    throw new ApiError(404, "Factory not found");
  }
  const factory = factoryRes.rows[0];

  // Perform dynamic stock calculations based on operation types
  const summaryRes = await pool.query(
    `
    SELECT 
      COALESCE(SUM(CASE WHEN operation_type IN ('production', 'transfer_to_kiln') AND type1_worker_id IS NOT NULL THEN quantity ELSE 0 END), 0) as total_molded,
      COALESCE(SUM(CASE WHEN operation_type = 'transfer_to_kiln' AND type2_worker_id IS NOT NULL THEN quantity ELSE 0 END), 0) as total_moved,
      COALESCE(SUM(CASE WHEN operation_type = 'load_internal' AND type3_worker_id IS NOT NULL THEN quantity ELSE 0 END), 0) as total_baked,
      COALESCE(SUM(CASE WHEN operation_type = 'load_outward' AND type3_worker_id IS NOT NULL THEN quantity ELSE 0 END), 0) as total_sales,
      COALESCE(SUM(CASE WHEN operation_type = 'load_inward' AND type3_worker_id IS NOT NULL THEN quantity ELSE 0 END), 0) as total_returns
    FROM kiln_work_logs
    WHERE kiln_factory_id = $1
    `,
    [factoryId]
  );

  const {
    total_molded,
    total_moved,
    total_baked,
    total_sales,
    total_returns
  } = summaryRes.rows[0];

  const parsedMolded = parseInt(total_molded, 10);
  const parsedMoved = parseInt(total_moved, 10);
  const parsedBaked = parseInt(total_baked, 10);
  const parsedSales = parseInt(total_sales, 10);
  const parsedReturns = parseInt(total_returns, 10);

  // Math rules for inventory tracking
  const rawFieldStock = Math.max(0, parsedMolded - parsedMoved);
  const kilnStock = Math.max(0, parsedMoved - parsedBaked);
  const stockyardStock = Math.max(0, parsedBaked + parsedReturns - parsedSales);
  const netSold = Math.max(0, parsedSales - parsedReturns);

  res.status(200).json({
    ...factory,
    inventory: {
      raw_field_stock: rawFieldStock,
      kiln_stock: kilnStock,
      stockyard_stock: stockyardStock,
      net_sold: netSold,
      metrics: {
        total_molded: parsedMolded,
        total_moved_to_kiln: parsedMoved,
        total_baked_unloaded: parsedBaked,
        total_sales_loaded: parsedSales,
        total_returns_unloaded: parsedReturns
      }
    }
  });
}
