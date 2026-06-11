import express from "express";
import { createPayment } from "./create/create.controllers.js";
import { listPayments } from "./read/read.controllers.js";
import { updatePayment } from "./update/update.controllers.js";
import { deletePayment } from "./delete/delete.controllers.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { createPaymentSchema, updatePaymentSchema } from "../../utils/validators.js";

const router = express.Router({ mergeParams: true });

router.post("/", validate(createPaymentSchema), asyncHandler(createPayment));
router.get("/", asyncHandler(listPayments));
router.put("/:paymentId", validate(updatePaymentSchema), asyncHandler(updatePayment));
router.delete("/:paymentId", asyncHandler(deletePayment));

export default router;
