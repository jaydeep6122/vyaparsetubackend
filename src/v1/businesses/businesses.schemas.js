import { z } from "zod";
import {
  address,
  decimal,
  email,
  gstin,
  ifsc,
  optionalText,
  pan,
  phone,
  stateCode,
  text,
} from "../../utils/schemas.js";

const registrationType = z.enum(["regular", "composition", "unregistered"]);
// The mobile app keeps the logo and signature inline as data URIs (there is
// no file storage yet), so either a web URL or a small image data URI is fine.
const image = z
  .string()
  .trim()
  .max(500_000, "Image is too large; use one under about 350 KB")
  .regex(
    /^(https?:\/\/\S+|data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+={0,2})$/,
    "Must be an image URL or a PNG, JPEG or WEBP image",
  )
  .nullable()
  .optional();

const settings = z.object({
  round_off_invoices: z.boolean().optional(),
  invoice_terms: optionalText(2000),
});

const businessFields = {
  name: text(255),
  legal_name: optionalText(255),
  gst_registration_type: registrationType,
  gstin: gstin.nullable().optional(),
  pan: pan.nullable().optional(),
  state_code: stateCode,
  address: address.optional(),
  phone: phone.nullable().optional(),
  email: email.nullable().optional(),
  logo_url: image,
  signature_url: image,
  fy_start_month: z.number().int().min(1).max(12).optional(),
  settings: settings.optional(),
};

function gstinMatchesState(data, ctx) {
  if (data.gstin && data.state_code && data.gstin.slice(0, 2) !== data.state_code) {
    ctx.addIssue({
      code: "custom",
      path: ["state_code"],
      message: "state_code must match the first two digits of the GSTIN",
    });
  }
}

export const createBusinessSchema = z
  .object({
    ...businessFields,
    gst_registration_type: registrationType.optional(),
    opening_cash_balance: decimal({ dp: 2 }).optional(),
    bank_account: z
      .object({
        name: text(100),
        bank_name: optionalText(100),
        account_number: optionalText(34),
        ifsc: ifsc.nullable().optional(),
        upi_id: optionalText(100),
        opening_balance: decimal({ dp: 2 }).optional(),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.gst_registration_type ?? "unregistered") !== "unregistered" && !data.gstin) {
      ctx.addIssue({
        code: "custom",
        path: ["gstin"],
        message: "GSTIN is required for a GST-registered business",
      });
    }
    gstinMatchesState(data, ctx);
  });

export const updateBusinessSchema = z.object(businessFields).partial().superRefine(gstinMatchesState);

const assignableRole = z.enum(["admin", "accountant", "staff"]);

export const inviteSchema = z.object({ email, role: assignableRole });
export const changeRoleSchema = z.object({ role: assignableRole });
export const acceptInviteSchema = z.object({ token: z.string().min(1).max(200) });

export const updateSeriesSchema = z.object({
  prefix: z.string().trim().max(20).optional(),
  next_number: z.number().int().min(1).optional(),
  padding: z.number().int().min(1).max(10).optional(),
});
