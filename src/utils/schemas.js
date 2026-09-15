import { z } from "zod";
import { dec } from "./money.js";

// Shared building blocks for request schemas. None of them declare
// `.default()`: zod applies defaults even inside `.partial()`, which would
// make PATCH requests reset fields the client never sent.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const id = z
  .string()
  .trim()
  .regex(UUID_RE, "Must be a valid id")
  .transform((value) => value.toLowerCase());

/** Required, trimmed text. */
export const text = (max) => z.string().trim().min(1, "Cannot be empty").max(max);

/** Optional text: "" or null clears the value, undefined leaves it unchanged. */
export const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "Not a real date");

/**
 * Accepts a JSON number or a numeric string and yields a plain decimal string
 * (e.g. "18.5"), so amounts never pass through float arithmetic.
 */
export function decimal({ dp = 2, min, max, gt } = {}) {
  return z
    .union([z.number().finite(), z.string().trim().regex(NUMERIC_RE, "Must be a number")])
    .superRefine((value, ctx) => {
      const number = dec(value);
      const fail = (message) => ctx.addIssue({ code: "custom", message });
      if (number.decimalPlaces() > dp) fail(`Use at most ${dp} decimal places`);
      else if (gt !== undefined && !number.gt(gt)) fail(`Must be greater than ${gt}`);
      else if (min !== undefined && number.lt(min)) fail(`Must be at least ${min}`);
      else if (max !== undefined && number.gt(max)) fail(`Must be at most ${max}`);
    })
    .transform((value) => dec(value).toFixed());
}

export const money = (options) => decimal({ dp: 2, min: 0, max: 1e13, ...options });
export const quantity = (options) => decimal({ dp: 3, max: 1e12, ...options });
export const unitRate = (options) => decimal({ dp: 4, min: 0, max: 1e11, ...options });
export const percent = () => decimal({ dp: 2, min: 0, max: 100 });

export const stateCode = z.string().trim().regex(/^\d{2}$/, "Must be a 2-digit GST state code");
export const gstin = z.string().trim().toUpperCase().regex(GSTIN_RE, "Invalid GSTIN");
export const pan = z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN");
export const ifsc = z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC code");
export const hsnSac = z.string().trim().regex(/^\d{4,8}$/, "HSN/SAC must be 4 to 8 digits");
export const email = z.string().trim().toLowerCase().max(255).email("Invalid email");
export const phone = z.string().trim().regex(/^[0-9+\-\s]{6,20}$/, "Invalid phone number");
export const vehicleNo = z
  .string()
  .trim()
  .toUpperCase()
  .max(20)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();
export const unitCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,10}$/, "Unit must be 2 to 10 letters, e.g. NOS, KGS, BOX");

export const address = z.object({
  line1: optionalText(255),
  line2: optionalText(255),
  city: optionalText(100),
  state: optionalText(100),
  pincode: z.string().trim().regex(/^\d{6}$/, "Pincode must be 6 digits").nullable().optional(),
  country: optionalText(100),
});

export const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

/** Query schema for list endpoints: pagination plus the endpoint's filters. */
export const listQuery = (shape = {}) =>
  z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    ...shape,
  });

export const dateRangeQuery = (shape = {}) =>
  z
    .object({ from: date.optional(), to: date.optional(), ...shape })
    .refine((q) => !q.from || !q.to || q.from <= q.to, {
      message: "from must be on or before to",
      path: ["from"],
    });
