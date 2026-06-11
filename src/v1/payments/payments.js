import express from "express";
import { createPayment } from "./create/create.controllers.js";
import { listPayments } from "./read/read.controllers.js";
import { deletePayment } from "./delete/delete.controllers.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const router = express.Router({ mergeParams: true });

router.post("/", asyncHandler(createPayment));
router.get("/", asyncHandler(listPayments));
router.delete("/:paymentId", asyncHandler(deletePayment));

export default router;
