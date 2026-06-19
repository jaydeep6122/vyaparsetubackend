import { z } from "zod";

export const createFactorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  location: z.string().optional().nullable(),
});

export const updateFactorySchema = z.object({
  name: z.string().min(1, "Name cannot be empty").optional(),
  location: z.string().optional().nullable(),
});

export const createWorkerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["producer_molder", "kiln_worker", "truck_worker"]),
  rate_per_1000: z.number().positive("Rate must be positive"),
});

export const updateWorkerSchema = z.object({
  name: z.string().min(1, "Name cannot be empty").optional(),
  rate_per_1000: z.number().positive("Rate must be positive").optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const createHandoffSchema = z.object({
  kiln_worker_id: z.string().uuid("Invalid kiln worker ID"),
  producer_molder_id: z.string().uuid("Invalid producer molder ID"),
  quantity: z.number().int().positive("Quantity must be a positive integer"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  notes: z.string().optional().nullable(),
});

export const createDirectSchema = z.object({
  worker_id: z.string().uuid("Invalid worker ID"),
  quantity: z.number().int().positive("Quantity must be a positive integer").optional().nullable(),
  amount: z.number().positive("Amount must be positive").optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  notes: z.string().optional().nullable(),
}).refine((data) => {
  const hasQuantity = data.quantity !== undefined && data.quantity !== null;
  const hasAmount = data.amount !== undefined && data.amount !== null;
  return (hasQuantity || hasAmount) && !(hasQuantity && hasAmount);
}, {
  message: "Either quantity or amount must be provided, but not both",
  path: ["quantity"],
});

export const createTruckDistSchema = z.object({
  truck_worker_ids: z.array(z.string().uuid()).min(1, "At least one truck worker is required"),
  total_quantity: z.number().int().positive("Total quantity must be a positive integer"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  notes: z.string().optional().nullable(),
  is_in: z.boolean().optional().default(true),
});

export const createMoneyGivenSchema = z.object({
  worker_id: z.string().uuid("Invalid worker ID"),
  amount: z.number().positive("Amount must be positive"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  notes: z.string().optional().nullable(),
});
