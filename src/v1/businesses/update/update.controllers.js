import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function updateBusiness(req, res) {
  const { businessId } = req.params;
  const {
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
    is_active,
  } = req.body;

  // Validate required fields if they are sent (or enforce always required if present in body)
  if (
    name === "" ||
    address === "" ||
    city === "" ||
    state === "" ||
    pincode === "" ||
    business_type === "" ||
    invoice_prefix === "" ||
    financial_year === ""
  ) {
    throw new ApiError(400, "Required fields cannot be empty");
  }

  // Validate business type if sent
  const validBusinessTypes = ["retailer", "wholesaler", "service"];
  if (business_type && !validBusinessTypes.includes(business_type)) {
    throw new ApiError(
      400,
      "Invalid business_type. Must be one of: retailer, wholesaler, service"
    );
  }

  // Validate GSTIN format if provided
  let normalizedGstin = gstin;
  if (gstin) {
    const gstinRegex =
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
    if (!gstinRegex.test(gstin)) {
      throw new ApiError(400, "Invalid GSTIN format");
    }
    normalizedGstin = gstin.toUpperCase();
  }

  const normalizedPan = pan_number ? pan_number.toUpperCase() : pan_number;

  try {
    const query = `
      UPDATE businesses
      SET
        name = COALESCE($1, name),
        email = COALESCE($2, email),
        phone = COALESCE($3, phone),
        address = COALESCE($4, address),
        city = COALESCE($5, city),
        state = COALESCE($6, state),
        pincode = COALESCE($7, pincode),
        gstin = COALESCE($8, gstin),
        pan_number = COALESCE($9, pan_number),
        business_type = COALESCE($10, business_type),
        invoice_prefix = COALESCE($11, invoice_prefix),
        invoice_counter = COALESCE($12, invoice_counter),
        financial_year = COALESCE($13, financial_year),
        logo_url = COALESCE($14, logo_url),
        signature_url = COALESCE($15, signature_url),
        bank_name = COALESCE($16, bank_name),
        account_number = COALESCE($17, account_number),
        ifsc_code = COALESCE($18, ifsc_code),
        upi_id = COALESCE($19, upi_id),
        is_active = COALESCE($20, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $21
      RETURNING *
    `;

    const values = [
      name === undefined ? null : name,
      email === undefined ? null : email,
      phone === undefined ? null : phone,
      address === undefined ? null : address,
      city === undefined ? null : city,
      state === undefined ? null : state,
      pincode === undefined ? null : pincode,
      normalizedGstin === undefined ? null : normalizedGstin,
      normalizedPan === undefined ? null : normalizedPan,
      business_type === undefined ? null : business_type,
      invoice_prefix === undefined ? null : invoice_prefix,
      invoice_counter === undefined ? null : invoice_counter,
      financial_year === undefined ? null : financial_year,
      logo_url === undefined ? null : logo_url,
      signature_url === undefined ? null : signature_url,
      bank_name === undefined ? null : bank_name,
      account_number === undefined ? null : account_number,
      ifsc_code === undefined ? null : ifsc_code,
      upi_id === undefined ? null : upi_id,
      is_active === undefined ? null : is_active,
      businessId,
    ];

    const result = await pool.query(query, values);
    
    if (result.rowCount === 0) {
      throw new ApiError(404, "Business not found");
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new ApiError(400, "A business with this GSTIN already exists");
    }
    throw error;
  }
}
