import { z } from "zod";
import { date, decimal, ifsc, optionalText, queryBoolean, text } from "../../utils/schemas.js";

const accountFields = {
  name: text(100),
  account_type: z.enum(["cash", "bank"]),
  bank_name: optionalText(100),
  account_number: optionalText(34),
  ifsc: ifsc.nullable().optional(),
  upi_id: optionalText(100),
  is_default: z.boolean(),
  // Signed: a negative opening balance is an overdraft.
  opening_balance: decimal({ dp: 2, min: -1e13, max: 1e13 }),
  opening_balance_date: date,
};

export const createAccountSchema = z.object({
  ...accountFields,
  is_default: z.boolean().optional(),
  opening_balance: accountFields.opening_balance.optional(),
  opening_balance_date: date.optional(),
});

export const updateAccountSchema = z.object(accountFields).omit({ account_type: true }).partial();

export const listAccountsQuery = z.object({ include_archived: queryBoolean.optional() });
