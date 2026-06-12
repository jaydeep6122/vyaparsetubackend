import { createBusinessService } from "./create.services.js";
import { ApiError } from "../../../utils/ApiError.js";
import { invalidateBusinessCache } from "../../../utils/cacheInvalidation.js";

export async function createBusiness(req, res) {
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
  } = req.body;

  // Validate required fields
  if (
    !name ||
    !address ||
    !city ||
    !state ||
    !pincode ||
    !business_type ||
    !invoice_prefix ||
    !financial_year
  ) {
    throw new ApiError(
      400,
      "Name, address, city, state, pincode, business_type, invoice_prefix, and financial_year are required",
    );
  }

  // Validate business type enum
  const validBusinessTypes = ["retailer", "wholesaler", "service"];
  if (!validBusinessTypes.includes(business_type)) {
    throw new ApiError(
      400,
      "Invalid business_type. Must be one of: retailer, wholesaler, service",
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

  // Normalize PAN number if provided
  const normalizedPan = pan_number ? pan_number.toUpperCase() : pan_number;

  // The requireAuth middleware guarantees req.user is populated
  const userId = req.user.id;

  try {
    const business = await createBusinessService(userId, {
      name,
      email,
      phone,
      address,
      city,
      state,
      pincode,
      gstin: normalizedGstin,
      pan_number: normalizedPan,
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
    });

    await invalidateBusinessCache(business.id);
    res.status(204).end();
  } catch (error) {
    if (error.code === "23505") {
      throw new ApiError(400, "A business with this GSTIN already exists");
    }
    throw error;
  }
}
