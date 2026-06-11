import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function createParty(req, res) {
  const { businessId } = req.params;
  const {
    name,
    phone,
    email,
    gstin,
    billing_address,
    shipping_address,
    party_type,
    opening_balance = 0,
    opening_balance_type = "receive",
  } = req.body;

  if (!name || !party_type) {
    throw new ApiError(400, "Name and party_type are required");
  }

  const validPartyTypes = ["customer", "supplier", "both"];
  if (!validPartyTypes.includes(party_type)) {
    throw new ApiError(400, "Invalid party_type. Must be one of: customer, supplier, both");
  }

  const validBalanceTypes = ["receive", "pay"];
  if (!validBalanceTypes.includes(opening_balance_type)) {
    throw new ApiError(400, "Invalid opening_balance_type. Must be one of: receive, pay");
  }

  let normalizedGstin = gstin;
  if (gstin) {
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
    if (!gstinRegex.test(gstin)) {
      throw new ApiError(400, "Invalid GSTIN format");
    }
    normalizedGstin = gstin.toUpperCase();
  }

  const current_balance = opening_balance_type === "receive" 
    ? Number(opening_balance) 
    : -Number(opening_balance);

  try {
    const query = `
      INSERT INTO parties (
        business_id, name, phone, email, gstin, billing_address, 
        shipping_address, party_type, opening_balance, opening_balance_type, current_balance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const values = [
      businessId,
      name,
      phone || null,
      email || null,
      normalizedGstin || null,
      billing_address || null,
      shipping_address ? JSON.stringify(shipping_address) : null,
      party_type,
      opening_balance,
      opening_balance_type,
      current_balance,
    ];

    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new ApiError(400, "A party with this name already exists in this business");
    }
    throw error;
  }
}
