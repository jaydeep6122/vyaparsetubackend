import express from "express";
import {
  createWorker,
  listWorkers,
  getWorkerById,
  updateWorker,
  deleteWorker
} from "./workers.controllers.js";
import { asyncHandler } from "../../../utils/asyncHandler.js";
import { validate } from "../../../middlewares/validation.middlewares.js";
import { createKilnWorkerSchema, updateKilnWorkerSchema } from "../../../utils/validators.js";

const router = express.Router({ mergeParams: true });

router.post("/", validate(createKilnWorkerSchema), asyncHandler(createWorker));
router.get("/", asyncHandler(listWorkers));
router.get("/:workerId", asyncHandler(getWorkerById));
router.put("/:workerId", validate(updateKilnWorkerSchema), asyncHandler(updateWorker));
router.delete("/:workerId", asyncHandler(deleteWorker));

export default router;
