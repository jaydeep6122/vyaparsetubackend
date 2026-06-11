import express from "express";
import { createBusiness } from "./create/create.controllers.js";
import { listBusinesses, getBusinessById } from "./read/read.controllers.js";
import { updateBusiness } from "./update/update.controllers.js";
import { deleteBusiness } from "./delete/delete.controllers.js";
import partiesRouter from "../parties/parties.js";
import itemsRouter from "../items/items.js";
import invoicesRouter from "../invoices/invoices.js";
import paymentsRouter from "../payments/payments.js";
import expensesRouter from "../expenses/expenses.js";
import dashboardRouter from "../dashboard/dashboard.js";
import { requireAuth, requireBusinessOwner } from "../../middlewares/auth.middlewares.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { createBusinessSchema, updateBusinessSchema } from "../../utils/validators.js";

const router = express.Router();

// Apply requireAuth middleware so all business actions require a valid access token
router.use(requireAuth);

router.post("/", validate(createBusinessSchema), asyncHandler(createBusiness));
router.get("/", asyncHandler(listBusinesses));
router.get("/:businessId", requireBusinessOwner, asyncHandler(getBusinessById));
router.put("/:businessId", requireBusinessOwner, validate(updateBusinessSchema), asyncHandler(updateBusiness));
router.delete("/:businessId", requireBusinessOwner, asyncHandler(deleteBusiness));

// Nested resources
router.use("/:businessId/parties", requireBusinessOwner, partiesRouter);
router.use("/:businessId/items", requireBusinessOwner, itemsRouter);
router.use("/:businessId/invoices", requireBusinessOwner, invoicesRouter);
router.use("/:businessId/payments", requireBusinessOwner, paymentsRouter);
router.use("/:businessId/expenses", requireBusinessOwner, expensesRouter);
router.use("/:businessId/dashboard", requireBusinessOwner, dashboardRouter);

export default router;
