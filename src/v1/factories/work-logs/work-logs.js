import express from "express";
import {
  createWorkLog,
  listWorkLogs,
  deleteWorkLog
} from "./work-logs.controllers.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { validate } from "../../../middlewares/validation.middlewares.js";
import { createKilnWorkLogSchema } from "../../../utils/validators.js";

const router = express.Router({ mergeParams: true });

router.post("/", validate(createKilnWorkLogSchema), asyncHandler(createWorkLog));
router.get("/", asyncHandler(listWorkLogs));
router.delete("/:logId", asyncHandler(deleteWorkLog));

export default router;
