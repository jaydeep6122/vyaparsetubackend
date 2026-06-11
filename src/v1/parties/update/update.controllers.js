import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function updateParty(req, res) {
  const { businessId, partyId } = req.params;
  const {
    name,
    phone,
    email,
    gstin,
    billing_address,
    shipping_address,
    party_type,
    opening_balance,
    opening_balance_type,
  } = req.body;

  // Verify the party exists first
  const existingResult = await pool.query(
    "SELECT * FROM parties WHERE id = $1 AND business_id = $2",
    [partyId, businessId]
  );
  if (existingResult.rowCount === 0) {
    throw new ApiError(404, "Party not found");
  }
  const oldParty = existingResult.rows[0];

  if (name === "") {
    throw new ApiError(400, "Name cannot be empty");
  }

  if (party_type && !["customer", "supplier", "both"].includes(party_type)) {
    throw new ApiError(400, "Invalid party_type");
  }

  if (opening_balance_type && !["receive", "pay"].includes(opening_balance_type)) {
    throw new ApiError(400, "Invalid opening_balance_type");
  }

  let normalizedGstin = gstin;
  if (gstin) {
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
    if (!gstinRegex.test(gstin)) {
      throw new ApiError(400, "Invalid GSTIN format");
    }
    normalizedGstin = gstin.toUpperCase();
  }

  // If opening balance changes, recalculate current balance correctly
  let updatedCurrentBalance = oldParty.current_balance;
  if (opening_balance !== undefined || opening_balance_type !== undefined) {
    const newOpenBalance = opening_balance !== undefined ? Number(opening_balance) : Number(oldParty.opening_balance);
    const newOpenType = opening_balance_type !== undefined ? opening_balance_type : oldParty.opening_balance_type;

    const oldContribution = oldParty.opening_balance_type === "receive" 
      ? Number(oldParty.opening_balance) 
      : -Number(oldParty.opening_balance);

    const newContribution = newOpenType === "receive" 
      ? newOpenBalance 
      : -newOpenBalance;

    updatedCurrentBalance = Number(oldParty.current_balance) - oldContribution + newContribution;
  }

  try {
    const query = `
      UPDATE parties
      SET
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        email = COALESCE($3, email),
        gstin = COALESCE($4, gstin),
        billing_address = COALESCE($5, billing_address),
        shipping_address = COALESCE($6, shipping_address),
        party_type = COALESCE($7, party_type),
        opening_balance = COALESCE($8, opening_balance),
        opening_balance_type = COALESCE($9, opening_balance_type),
        current_balance = $10,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11 AND business_id = $12
      RETURNING *
    `;

    const values = [
      name === undefined ? null : name,
      phone === undefined ? null : phone,
      email === undefined ? null : email,
      normalizedGstin === undefined ? null : normalizedGstin,
      billing_address === undefined ? null : billing_address,
      shipping_address === undefined ? null : (shipping_address ? JSON.stringify(shipping_address) : null),
      party_type === undefined ? null : party_type,
      opening_balance === undefined ? null : opening_balance,
      opening_balance_type === undefined ? null : opening_balance_type,
      updatedCurrentBalance,
      partyId,
      businessId,
    ];

    const result = await pool.query(query, values);
    res.status(200).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new ApiError(400, "A party with this name already exists in this business");
    }
    throw error;
  }
}
