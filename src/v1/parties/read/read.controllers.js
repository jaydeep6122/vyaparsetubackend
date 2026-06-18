import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function listParties(req, res) {
  const { businessId } = req.params;
  const { party_type, search } = req.query;

  let query = "SELECT * FROM parties WHERE business_id = $1";
  const values = [businessId];
  let paramIndex = 2;

  if (party_type) {
    query += ` AND party_type = $${paramIndex}`;
    values.push(party_type);
    paramIndex++;
  }

  if (search) {
    query += ` AND (name ILIKE $${paramIndex} OR phone ILIKE $${paramIndex})`;
    values.push(`%${search}%`);
    paramIndex++;
  }

  query += " ORDER BY name ASC";

  const result = await pool.query(query, values);
  res.status(200).json(result.rows);
}

export async function getPartyById(req, res) {
  const { businessId, partyId } = req.params;
  const result = await pool.query(
    "SELECT * FROM parties WHERE id = $1 AND business_id = $2",
    [partyId, businessId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Party not found");
  }

  res.status(200).json(result.rows[0]);
}

export async function getPartyQuantitySummary(req, res) {
  const { businessId, partyId } = req.params;

  // 1. Verify party exists and belongs to the business
  const partyCheck = await pool.query(
    "SELECT id, name FROM parties WHERE id = $1 AND business_id = $2",
    [partyId, businessId]
  );
  if (partyCheck.rowCount === 0) {
    throw new ApiError(404, "Party not found");
  }

  // 2. Query aggregated quantities of all items transacted with this party
  const query = `
    SELECT 
      ii.item_id,
      ii.name AS item_name,
      i.invoice_type,
      SUM(ii.quantity) AS total_quantity
    FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE i.party_id = $1 AND i.business_id = $2
    GROUP BY ii.item_id, ii.name, i.invoice_type
  `;
  const result = await pool.query(query, [partyId, businessId]);

  const itemMap = {};

  for (const row of result.rows) {
    const itemId = row.item_id || `deleted-${row.item_name}`;
    const qty = Number(row.total_quantity);
    const type = row.invoice_type;

    if (!itemMap[itemId]) {
      itemMap[itemId] = {
        item_id: row.item_id,
        item_name: row.item_name,
        sold: 0,
        purchased: 0,
        sale_returned: 0,
        purchase_returned: 0
      };
    }

    if (type === "sale") itemMap[itemId].sold += qty;
    else if (type === "purchase") itemMap[itemId].purchased += qty;
    else if (type === "sale_return") itemMap[itemId].sale_returned += qty;
    else if (type === "purchase_return") itemMap[itemId].purchase_returned += qty;
  }

  res.status(200).json({
    partyId,
    items: Object.values(itemMap)
  });
}

