import { z } from "zod";
import {
  address,
  date,
  email,
  gstin,
  listQuery,
  money,
  optionalText,
  phone,
  queryBoolean,
  stateCode,
  text,
} from "../../utils/schemas.js";

const partyType = z.enum(["customer", "supplier", "both", "transporter"]);
const gstType = z.enum(["registered", "unregistered", "composition", "consumer", "overseas"]);

const partyFields = {
  name: text(255),
  party_type: partyType,
  phone: phone.nullable().optional(),
  email: email.nullable().optional(),
  gst_type: gstType,
  gstin: gstin.nullable().optional(),
  state_code: stateCode.nullable().optional(),
  billing_address: address.nullable().optional(),
  shipping_address: address.nullable().optional(),
  credit_limit: money().nullable().optional(),
  credit_days: z.number().int().min(0).max(3650).nullable().optional(),
  notes: optionalText(2000),
  opening_balance: money().optional(),
  opening_balance_type: z.enum(["receivable", "payable"]).optional(),
  opening_balance_date: date.optional(),
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

export const createPartySchema = z
  .object({ ...partyFields, gst_type: gstType.optional() })
  .superRefine((data, ctx) => {
    if ((data.gst_type === "registered" || data.gst_type === "composition") && !data.gstin) {
      ctx.addIssue({ code: "custom", path: ["gstin"], message: "GSTIN is required for this GST type" });
    }
    gstinMatchesState(data, ctx);
  });

export const updatePartySchema = z.object(partyFields).partial().superRefine(gstinMatchesState);

export const listPartiesQuery = listQuery({
  search: z.string().trim().max(100).optional(),
  party_type: partyType.optional(),
  include_archived: queryBoolean.optional(),
});
