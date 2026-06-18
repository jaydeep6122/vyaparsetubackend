import express from "express";
import {
  previewSettlement,
  createSettlement,
  listSettlements
} from "./settlements.controllers.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { validate } from "../../../middlewares/validation.middlewares.js";
import { createKilnSettlementSchema } from "../../../utils/validators.js";

const router = express.Router({ mergeParams: true });

router.get("/preview/:workerId", asyncHandler(previewSettlement));
router.post("/", validate(createKilnSettlementSchema), asyncHandler(createSettlement));
router.get("/", asyncHandler(listSettlements));

export default router;
