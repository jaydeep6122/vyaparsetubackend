import pool from "../../../db/db.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function getStockStatusReport(req, res) {
  const { businessId } = req.params;

  const result = await pool.query(
    `SELECT id, name, hsn_code, measuring_unit
     FROM items
     WHERE business_id = $1
     ORDER BY name ASC`,
    [businessId]
  );

  const items = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    sku: null,
    item_type: "product",
    current_stock: 0,
    purchase_price: 0,
    sales_price: 0,
    measuring_unit: row.measuring_unit,
    stock_valuation: 0,
  }));

  res.status(200).json({
    items,
    total_valuation: 0,
  });
}
