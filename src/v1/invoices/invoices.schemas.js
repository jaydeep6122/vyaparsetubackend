import { z } from "zod";
import {
  address,
  date,
  email,
  hsnSac,
  id,
  listQuery,
  money,
  optionalText,
  percent,
  phone,
  quantity,
  queryBoolean,
  stateCode,
  unitCode,
  unitRate,
  vehicleNo,
} from "../../utils/schemas.js";
import { paidNowSchema } from "../payments/payments.schemas.js";

const invoiceType = z.enum(["sale", "purchase", "sale_return", "purchase_return"]);
const taxMode = z.enum(["gst", "non_gst"]);
const custom = (ctx, path, message) => ctx.addIssue({ code: "custom", path, message });

const lineSchema = z
  .object({
    item_id: id.nullable().optional(),
    description: optionalText(500),
    hsn_sac: hsnSac.nullable().optional(),
    quantity: quantity({ gt: 0 }),
    unit_code: unitCode.nullable().optional(),
    // Defaults to the item's sale or purchase price.
    unit_price: unitRate().optional(),
    discount_pct: percent().optional(),
    discount_amount: money().optional(),
    // Defaults to the item's GST rate; ignored on non-GST bills.
    tax_rate: percent().optional(),
    cess_rate: percent().optional(),
  })
  .superRefine((line, ctx) => {
    if (line.discount_pct !== undefined && line.discount_amount !== undefined) {
      custom(ctx, ["discount_amount"], "Give either discount_pct or discount_amount, not both");
    }
    if (!line.item_id && (!line.description || line.unit_price === undefined)) {
      custom(ctx, ["description"], "A line without item_id needs a description and unit_price");
    }
  });

const chargeSchema = z
  .object({
    // Present when editing an existing charge.
    id: id.optional(),
    charge_type: z.enum(["transport", "loading", "unloading", "packing", "other"]),
    description: optionalText(255),
    // Defaults to payee_only when a payee is given, else invoice_party.
    bill_to: z.enum(["invoice_party", "payee_only"]).optional(),
    payee_party_id: id.nullable().optional(),
    vehicle_no: vehicleNo,
    qty: quantity({ gt: 0 }).optional(),
    rate: unitRate().optional(),
    amount: money().optional(),
    tax_rate: percent().optional(),
    // Pay the payee (e.g. the transporter) at the same time; create only.
    paid_now: paidNowSchema.optional(),
  })
  .superRefine((charge, ctx) => {
    const byRate = charge.qty !== undefined || charge.rate !== undefined;
    if (byRate && (charge.qty === undefined || charge.rate === undefined)) {
      custom(ctx, ["rate"], "Give both qty and rate");
    } else if (byRate && charge.amount !== undefined) {
      custom(ctx, ["amount"], "Give qty and rate, or amount, not both");
    } else if (!byRate && charge.amount === undefined) {
      custom(ctx, ["amount"], "Give either qty and rate, or amount");
    }
    if (charge.bill_to === "payee_only" && !charge.payee_party_id) {
      custom(ctx, ["payee_party_id"], "A payee_only charge needs payee_party_id");
    }
    if (charge.paid_now && !charge.payee_party_id) {
      custom(ctx, ["paid_now"], "Only a charge with a payee can be paid now");
    }
  });

const invoiceFields = {
  invoice_type: invoiceType,
  // Defaults to gst for regular GST-registered businesses, else non_gst.
  tax_mode: taxMode.optional(),
  status: z.enum(["draft", "final"]).optional(),
  // Taken from the document series when omitted.
  invoice_number: optionalText(50),
  invoice_date: date.optional(),
  due_date: date.nullable().optional(),
  supplier_invoice_number: optionalText(50),
  supplier_invoice_date: date.nullable().optional(),
  party_id: id.nullable().optional(),
  // Name printed on a walk-in cash sale.
  party_name: optionalText(255),
  billing_address: address.nullable().optional(),
  shipping_address: address.nullable().optional(),
  place_of_supply: stateCode.optional(),
  is_reverse_charge: z.boolean().optional(),
  original_invoice_id: id.nullable().optional(),
  price_includes_tax: z.boolean().optional(),

  vehicle_no: vehicleNo,
  driver_name: optionalText(100),
  driver_phone: phone.nullable().optional(),
  transport_mode: z.enum(["road", "rail", "air", "ship", "self"]).nullable().optional(),
  lr_no: optionalText(50),
  lr_date: date.nullable().optional(),
  eway_bill_no: z.string().trim().regex(/^\d{12}$/, "E-way bill number must be 12 digits").nullable().optional(),
  eway_bill_date: date.nullable().optional(),
  chalan_no: optionalText(50),
  delivery_date: date.nullable().optional(),
  dispatch_from: address.nullable().optional(),
  ship_to: address.nullable().optional(),

  notes: optionalText(5000),
  terms: optionalText(5000),
  lines: z.array(lineSchema).min(1, "An invoice needs at least one line").max(500),
  charges: z.array(chargeSchema).max(20).optional(),
};

export const createInvoiceSchema = z.object({ ...invoiceFields, payment: paidNowSchema.optional() });

/** PUT sends the whole invoice again; fields left out are cleared. */
export const updateInvoiceSchema = z.object(invoiceFields);

export const emailInvoiceSchema = z.object({
  // Defaults to the party's email.
  to: email.optional(),
  message: optionalText(1000),
});

export const pdfQuery = z.object({ download: queryBoolean.optional() });

export const listInvoicesQuery = listQuery({
  invoice_type: invoiceType.optional(),
  tax_mode: taxMode.optional(),
  status: z.enum(["draft", "final", "cancelled"]).optional(),
  payment_status: z.enum(["paid", "partially_paid", "unpaid"]).optional(),
  party_id: id.optional(),
  from: date.optional(),
  to: date.optional(),
  overdue: queryBoolean.optional(),
  search: z.string().trim().max(100).optional(),
});
