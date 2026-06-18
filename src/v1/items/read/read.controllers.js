import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function listItems(req, res) {
  const { businessId } = req.params;
  const { search } = req.query;

  let query = "SELECT * FROM items WHERE business_id = $1";
  const values = [businessId];
  let paramIndex = 2;

  if (search) {
    query += ` AND name ILIKE $${paramIndex}`;
    values.push(`%${search}%`);
    paramIndex++;
  }

  query += " ORDER BY name ASC";

  const result = await pool.query(query, values);
  res.status(200).json(result.rows);
}

export async function getItemById(req, res) {
  const { businessId, itemId } = req.params;
  const result = await pool.query(
    "SELECT * FROM items WHERE id = $1 AND business_id = $2",
    [itemId, businessId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Item not found");
  }

  res.status(200).json(result.rows[0]);
}

export async function getItemQuantitySummary(req, res) {
  const { businessId, itemId } = req.params;

  // 1. Verify item exists and belongs to the business
  const itemCheck = await pool.query(
    "SELECT id, name FROM items WHERE id = $1 AND business_id = $2",
    [itemId, businessId]
  );
  if (itemCheck.rowCount === 0) {
    throw new ApiError(404, "Item not found");
  }

  // 2. Query aggregated quantities of this item grouped by party and invoice_type
  const query = `
    SELECT 
      i.party_id,
      p.name AS party_name,
      i.invoice_type,
      SUM(ii.quantity) AS total_quantity
    FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    LEFT JOIN parties p ON i.party_id = p.id
    WHERE ii.item_id = $1 AND i.business_id = $2
    GROUP BY i.party_id, p.name, i.invoice_type
  `;
  const result = await pool.query(query, [itemId, businessId]);

  const overall = {
    sold: 0,
    purchased: 0,
    sale_returned: 0,
    purchase_returned: 0
  };
  const partyMap = {};

  for (const row of result.rows) {
    const qty = Number(row.total_quantity);
    const type = row.invoice_type;

    if (type === "sale") overall.sold += qty;
    else if (type === "purchase") overall.purchased += qty;
    else if (type === "sale_return") overall.sale_returned += qty;
    else if (type === "purchase_return") overall.purchase_returned += qty;

    const partyId = row.party_id;
    const partyKey = partyId || "walk-in";
    const partyName = row.party_name || "Walk-in/Unknown";

    if (!partyMap[partyKey]) {
      partyMap[partyKey] = {
        party_id: partyId,
        party_name: partyName,
        sold: 0,
        purchased: 0,
        sale_returned: 0,
        purchase_returned: 0
      };
    }

    if (type === "sale") partyMap[partyKey].sold += qty;
    else if (type === "purchase") partyMap[partyKey].purchased += qty;
    else if (type === "sale_return") partyMap[partyKey].sale_returned += qty;
    else if (type === "purchase_return") partyMap[partyKey].purchase_returned += qty;
  }

  res.status(200).json({
    itemId,
    overall,
    byParty: Object.values(partyMap)
  });
}

