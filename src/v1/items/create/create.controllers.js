import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function createItem(req, res) {
  const { businessId } = req.params;
  const {
    name,
    item_type,
    sku,
    hsn_code,
    sales_price = 0,
    purchase_price = 0,
    tax_rate = 0,
    is_tax_inclusive = false,
    measuring_unit = "pcs",
    opening_stock = 0,
    low_stock_warning = 0,
  } = req.body;

  if (!name || !item_type) {
    throw new ApiError(400, "Name and item_type are required");
  }

  if (!["product", "service"].includes(item_type)) {
    throw new ApiError(400, "Invalid item_type. Must be product or service");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const current_stock = item_type === "product" ? Number(opening_stock) : 0;

    const query = `
      INSERT INTO items (
        business_id, name, item_type, sku, hsn_code, sales_price, 
        purchase_price, tax_rate, is_tax_inclusive, measuring_unit, 
        opening_stock, current_stock, low_stock_warning
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;
    const values = [
      businessId,
      name,
      item_type,
      sku || null,
      hsn_code || null,
      sales_price,
      purchase_price,
      tax_rate,
      is_tax_inclusive,
      measuring_unit,
      opening_stock,
      current_stock,
      low_stock_warning,
    ];

    const result = await client.query(query, values);
    const item = result.rows[0];

    if (item_type === "product" && Number(opening_stock) > 0) {
      await client.query(
        `INSERT INTO stock_transactions (
          business_id, item_id, transaction_type, quantity, notes
         ) VALUES ($1, $2, 'adjustment_add', $3, 'Opening stock')`,
        [businessId, item.id, opening_stock]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(item);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new ApiError(400, "An item with this name already exists in this business");
    }
    throw error;
  } finally {
    client.release();
  }
}
