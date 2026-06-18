import express from "express";
import {
  createTransaction,
  listTransactions
} from "./transactions.controllers.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { validate } from "../../../middlewares/validation.middlewares.js";
import { createKilnTransactionSchema } from "../../../utils/validators.js";

const router = express.Router({ mergeParams: true });

router.post("/", validate(createKilnTransactionSchema), asyncHandler(createTransaction));
router.get("/", asyncHandler(listTransactions));

export default router;
