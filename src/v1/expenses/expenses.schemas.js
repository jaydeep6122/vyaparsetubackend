import { z } from "zod";
import { date, id, listQuery, money, optionalText } from "../../utils/schemas.js";
import { paidNowSchema } from "../payments/payments.schemas.js";

const expenseFields = {
  expense_number: optionalText(50),
  expense_date: date.optional(),
  category_id: id.nullable().optional(),
  // The vendor, if the expense is owed to someone.
  party_id: id.nullable().optional(),
  tax_mode: z.enum(["gst", "non_gst"]).optional(),
  taxable_amount: money(),
  cgst_amount: money().optional(),
  sgst_amount: money().optional(),
  igst_amount: money().optional(),
  cess_amount: money().optional(),
  itc_eligible: z.boolean().optional(),
  notes: optionalText(2000),
};

export const createExpenseSchema = z.object({ ...expenseFields, payment: paidNowSchema.optional() });

/** PUT sends the whole expense again; fields left out are cleared. */
export const updateExpenseSchema = z.object(expenseFields);

export const listExpensesQuery = listQuery({
  category_id: id.optional(),
  party_id: id.optional(),
  status: z.enum(["active", "cancelled"]).optional(),
  payment_status: z.enum(["paid", "partially_paid", "unpaid"]).optional(),
  from: date.optional(),
  to: date.optional(),
  search: z.string().trim().max(100).optional(),
});
