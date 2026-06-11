import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function updateItem(req, res) {
  const { businessId, itemId } = req.params;
  const {
    name,
    sku,
    hsn_code,
    sales_price,
    purchase_price,
    tax_rate,
    is_tax_inclusive,
    measuring_unit,
    opening_stock,
    low_stock_warning,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      "SELECT * FROM items WHERE id = $1 AND business_id = $2",
      [itemId, businessId]
    );
    if (existingResult.rowCount === 0) {
      throw new ApiError(404, "Item not found");
    }
    const oldItem = existingResult.rows[0];

    if (name === "") {
      throw new ApiError(400, "Name cannot be empty");
    }

    let updatedCurrentStock = oldItem.current_stock;
    if (opening_stock !== undefined && oldItem.item_type === "product") {
      const diff = Number(opening_stock) - Number(oldItem.opening_stock);
      updatedCurrentStock = Number(oldItem.current_stock) + diff;

      if (diff !== 0) {
        await client.query(
          `INSERT INTO stock_transactions (
            business_id, item_id, transaction_type, quantity, notes
           ) VALUES ($1, $2, $3, $4, 'Opening stock adjusted')`,
          [
            businessId,
            itemId,
            diff > 0 ? "adjustment_add" : "adjustment_reduce",
            Math.abs(diff),
          ]
        );
      }
    }

    const query = `
      UPDATE items
      SET
        name = COALESCE($1, name),
        sku = COALESCE($2, sku),
        hsn_code = COALESCE($3, hsn_code),
        sales_price = COALESCE($4, sales_price),
        purchase_price = COALESCE($5, purchase_price),
        tax_rate = COALESCE($6, tax_rate),
        is_tax_inclusive = COALESCE($7, is_tax_inclusive),
        measuring_unit = COALESCE($8, measuring_unit),
        opening_stock = COALESCE($9, opening_stock),
        low_stock_warning = COALESCE($10, low_stock_warning),
        current_stock = $11,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $12 AND business_id = $13
      RETURNING *
    `;

    const values = [
      name === undefined ? null : name,
      sku === undefined ? null : sku,
      hsn_code === undefined ? null : hsn_code,
      sales_price === undefined ? null : sales_price,
      purchase_price === undefined ? null : purchase_price,
      tax_rate === undefined ? null : tax_rate,
      is_tax_inclusive === undefined ? null : is_tax_inclusive,
      measuring_unit === undefined ? null : measuring_unit,
      opening_stock === undefined ? null : opening_stock,
      low_stock_warning === undefined ? null : low_stock_warning,
      updatedCurrentStock,
      itemId,
      businessId,
    ];

    const result = await client.query(query, values);
    await client.query("COMMIT");
    res.status(200).json(result.rows[0]);
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
