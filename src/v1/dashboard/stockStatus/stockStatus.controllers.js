import pool from "../../../db/db.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function getStockStatusReport(req, res) {
  const { businessId } = req.params;

  const result = await pool.query(
    `SELECT id, name, sku, item_type, current_stock, purchase_price, sales_price, measuring_unit,
            (current_stock * purchase_price) as stock_valuation
     FROM items
     WHERE business_id = $1 AND item_type = 'product'
     ORDER BY name ASC`,
    [businessId]
  );

  let totalValuation = 0;
  result.rows.forEach((row) => {
    totalValuation += Number(row.stock_valuation || 0);
  });

  res.status(200).json({
    items: result.rows,
    total_valuation: round2(totalValuation),
  });
}
