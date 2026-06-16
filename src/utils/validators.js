import { z } from "zod";

// Auth Validation
export const signupSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email format"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(1, "Confirm password is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Password and confirm password do not match",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

// Business Validation
export const createBusinessSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  pincode: z.string().min(1, "Pincode is required"),
  gstin: z
    .string()
    .regex(
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
      "Invalid GSTIN format",
    )
    .optional()
    .nullable(),
  pan_number: z.string().optional().nullable(),
  business_type: z.enum(["retailer", "wholesaler", "service"]),
  invoice_prefix: z.string().min(1, "Invoice prefix is required"),
  invoice_counter: z.number().int().positive().optional(),
  financial_year: z.string().min(1, "Financial year is required"),
  logo_url: z.string().url("Invalid URL").optional().nullable(),
  signature_url: z.string().url("Invalid URL").optional().nullable(),
  bank_name: z.string().optional().nullable(),
  account_number: z.string().optional().nullable(),
  ifsc_code: z.string().optional().nullable(),
  upi_id: z.string().optional().nullable(),
});

export const updateBusinessSchema = createBusinessSchema.partial();

// Party Validation
export const createPartySchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional().nullable(),
  email: z.union([z.string().email("Invalid email"), z.literal("")]).optional().nullable(),
  gstin: z.string().optional().nullable(),
  billing_address: z.string().optional().nullable(),
  shipping_address: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  party_type: z.enum(["customer", "supplier", "both"]),
  opening_balance: z.number().nonnegative().default(0),
  opening_balance_type: z.enum(["receive", "pay"]).default("receive"),
});

export const updatePartySchema = createPartySchema.partial();

// Item Validation
export const createItemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  hsn_code: z.string().optional().nullable(),
  measuring_unit: z.string().optional().nullable(),
});

export const updateItemSchema = createItemSchema.partial();

// Invoice Validation
const invoiceBaseObject = z.object({
  party_id: z.string().uuid("Invalid party ID").optional().nullable(),
  invoice_number: z.string().optional().nullable(),
  invoice_type: z.enum(["sale", "purchase", "sale_return", "purchase_return"]),
  chalan_no: z.string().optional().nullable(),
  transport_cost: z.number().nonnegative("Transport cost must be non-negative").optional(),
  invoice_date: z.string().optional(),
  due_date: z.string().optional().nullable(),
  discount_amount: z.number().nonnegative().optional(),
  paid_amount: z.number().nonnegative().optional(),
  payment_mode: z.enum(["cash", "bank", "upi", "credit", "multiple"]),
  notes: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        item_id: z.string().uuid("Invalid item ID").optional().nullable(),
        name: z.string().min(1, "Item name is required"),
        quantity: z.number().positive("Quantity must be positive"),
        unit_price: z.number().nonnegative("Unit price must be non-negative"),
        discount_percentage: z.number().min(0).max(100).optional(),
        tax_rate: z.number().nonnegative().optional(),
      }),
    )
    .min(1, "At least one item is required"),
});

export const createInvoiceSchema = invoiceBaseObject.superRefine((data, ctx) => {
  if (data.invoice_type !== "purchase" && (!data.invoice_number || data.invoice_number.trim() === "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invoice number is required",
      path: ["invoice_number"],
    });
  }
});

export const updateInvoiceSchema = invoiceBaseObject.partial().superRefine((data, ctx) => {
  if (data.invoice_type !== undefined && data.invoice_type !== "purchase") {
    if (data.invoice_number !== undefined && (!data.invoice_number || data.invoice_number.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invoice number cannot be empty",
        path: ["invoice_number"],
      });
    }
  }
});

// Payment Validation
export const createPaymentSchema = z.object({
  party_id: z.string().uuid("Invalid party ID"),
  invoice_id: z.string().uuid("Invalid invoice ID").optional().nullable(),
  payment_type: z.enum(["payment_in", "payment_out"]),
  amount: z.number().positive("Amount must be positive"),
  payment_mode: z.enum(["cash", "bank", "upi"]),
  reference_number: z.string().optional().nullable(),
  payment_date: z.string().optional(),
  description: z.string().optional().nullable(),
});

export const updatePaymentSchema = createPaymentSchema.partial();

// Expense Validation
export const createExpenseSchema = z.object({
  expense_category: z.string().min(1, "Expense category is required"),
  expense_number: z.string().min(1, "Expense number is required"),
  expense_date: z.string().optional(),
  total_amount: z.number().positive("Total amount must be positive"),
  paid_amount: z.number().nonnegative().optional(),
  payment_mode: z.enum(["cash", "bank", "upi", "credit"]),
  description: z.string().optional().nullable(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

// Refresh Token Validation
export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1, "Refresh token is required"),
});
