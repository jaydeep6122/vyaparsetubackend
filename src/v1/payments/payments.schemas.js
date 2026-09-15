import { z } from "zod";
import { date, id, listQuery, money, optionalText } from "../../utils/schemas.js";

export const paymentMode = z.enum(["cash", "upi", "bank_transfer", "cheque", "card", "other"]);

/** Money handed over together with a document ("paid now"). */
export const paidNowSchema = z.object({
  account_id: id,
  mode: paymentMode,
  amount: money({ gt: 0 }),
  reference_no: optionalText(100),
  cheque_no: optionalText(20),
  cheque_date: date.nullable().optional(),
});

const allocationSchema = z
  .object({
    invoice_id: id.optional(),
    invoice_charge_id: id.optional(),
    expense_id: id.optional(),
    amount: money({ gt: 0 }),
  })
  .refine(
    (allocation) =>
      [allocation.invoice_id, allocation.invoice_charge_id, allocation.expense_id].filter(Boolean).length === 1,
    { message: "Give exactly one of invoice_id, invoice_charge_id or expense_id" },
  );

const paymentFields = {
  payment_type: z.enum(["in", "out"]),
  payment_number: optionalText(50),
  payment_date: date.optional(),
  party_id: id.nullable().optional(),
  account_id: id,
  mode: paymentMode,
  amount: money({ gt: 0 }),
  reference_no: optionalText(100),
  cheque_no: optionalText(20),
  cheque_date: date.nullable().optional(),
  notes: optionalText(2000),
  allocations: z.array(allocationSchema).max(100).optional(),
};

export const createPaymentSchema = z.object(paymentFields);

/** PUT replaces the payment and its allocations; type and number stay fixed. */
export const updatePaymentSchema = z.object(paymentFields).omit({ payment_type: true, payment_number: true });

export const cancelSchema = z.object({ reason: optionalText(500) });

export const listPaymentsQuery = listQuery({
  payment_type: z.enum(["in", "out"]).optional(),
  party_id: id.optional(),
  account_id: id.optional(),
  mode: paymentMode.optional(),
  status: z.enum(["active", "cancelled"]).optional(),
  from: date.optional(),
  to: date.optional(),
  search: z.string().trim().max(100).optional(),
});
