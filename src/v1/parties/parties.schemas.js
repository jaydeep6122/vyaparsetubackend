import { z } from "zod";
import {
  address,
  date,
  email,
  gstin,
  id,
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

const hasContent = (value) =>
  Object.values(value ?? {}).some((field) => typeof field === "string" && field.trim() !== "");

/**
 * One saved address. Sending `id` keeps that address (and the bills that
 * point at it); an address without `id` is added.
 */
const partyAddress = z
  .object({
    id: id.optional(),
    kind: z.enum(["billing", "shipping"]),
    label: optionalText(50),
    is_default: z.boolean().optional(),
    address,
  })
  .refine((entry) => hasContent(entry.address), { message: "Address cannot be empty", path: ["address"] });

const partyFields = {
  name: text(255),
  party_type: partyType,
  phone: phone.nullable().optional(),
  email: email.nullable().optional(),
  gst_type: gstType,
  gstin: gstin.nullable().optional(),
  state_code: stateCode.nullable().optional(),
  // The whole set of saved addresses: anything not listed is removed. With no
  // default marked, the first of each kind becomes the default.
  addresses: z.array(partyAddress).max(40).optional(),
  // Older clients send one address of each kind. They set that kind's
  // default address and are ignored when `addresses` is sent.
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

function addressesAreConsistent(data, ctx) {
  if (!data.addresses) return;
  for (const kind of ["billing", "shipping"]) {
    const defaults = data.addresses.filter((entry) => entry.kind === kind && entry.is_default);
    if (defaults.length > 1) {
      ctx.addIssue({ code: "custom", path: ["addresses"], message: `Only one ${kind} address can be the default` });
    }
  }
  const ids = data.addresses.map((entry) => entry.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", path: ["addresses"], message: "The same address appears twice" });
  }
}

export const createPartySchema = z
  .object({ ...partyFields, gst_type: gstType.optional() })
  .superRefine((data, ctx) => {
    if ((data.gst_type === "registered" || data.gst_type === "composition") && !data.gstin) {
      ctx.addIssue({ code: "custom", path: ["gstin"], message: "GSTIN is required for this GST type" });
    }
    gstinMatchesState(data, ctx);
    addressesAreConsistent(data, ctx);
  });

export const updatePartySchema = z
  .object(partyFields)
  .partial()
  .superRefine((data, ctx) => {
    gstinMatchesState(data, ctx);
    addressesAreConsistent(data, ctx);
  });

export const listPartiesQuery = listQuery({
  search: z.string().trim().max(100).optional(),
  party_type: partyType.optional(),
  include_archived: queryBoolean.optional(),
});
