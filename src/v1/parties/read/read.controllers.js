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
