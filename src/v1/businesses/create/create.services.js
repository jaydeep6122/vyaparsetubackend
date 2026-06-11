import pool from "../../../db/db.js";

export const createBusinessService = async (userId, businessData) => {
  const {
    name,
    email = null,
    phone = null,
    address,
    city,
    state,
    pincode,
    gstin = null,
    pan_number = null,
    business_type,
    invoice_prefix,
    invoice_counter = 1,
    financial_year,
    logo_url = null,
    signature_url = null,
    bank_name = null,
    account_number = null,
    ifsc_code = null,
    upi_id = null,
  } = businessData;

  const query = `
    INSERT INTO businesses (
      user_id, name, email, phone, address, city, state, pincode, 
      gstin, pan_number, business_type, invoice_prefix, invoice_counter, 
      financial_year, logo_url, signature_url, bank_name, 
      account_number, ifsc_code, upi_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
    ) RETURNING *
  `;

  const values = [
    userId,
    name,
    email,
    phone,
    address,
    city,
    state,
    pincode,
    gstin,
    pan_number,
    business_type,
    invoice_prefix,
    invoice_counter,
    financial_year,
    logo_url,
    signature_url,
    bank_name,
    account_number,
    ifsc_code,
    upi_id,
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
};
