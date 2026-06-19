import express from "express";
import { requireAuth } from "../../middlewares/auth.middlewares.js";
import { requireFactoryOwner } from "./middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import {
  createFactorySchema,
  updateFactorySchema,
  createWorkerSchema,
  updateWorkerSchema,
  createHandoffSchema,
  createDirectSchema,
  createTruckDistSchema,
  createMoneyGivenSchema,
} from "./validators.js";
import { createFactory } from "./create/create.controllers.js";
import { listFactories, getFactoryById } from "./read/read.controllers.js";
import { updateFactory } from "./update/update.controllers.js";
import { createWorker } from "./workers/create.controllers.js";
import { listWorkers, getWorkerById } from "./workers/read.controllers.js";
import { updateWorker } from "./workers/update.controllers.js";
import { deleteWorker } from "./workers/delete.controllers.js";
import {
  createHandoff,
  createDirect,
  createTruckDistribution,
  createMoneyGiven,
} from "./transactions/create.controllers.js";
import {
  listTransactions,
  getTransactionById,
  getWorkerTransactions,
} from "./transactions/read.controllers.js";
import { getWorkerSummary, getFactorySummary } from "./reports/read.controllers.js";

const router = express.Router();

router.use(requireAuth);

router.post("/", validate(createFactorySchema), asyncHandler(createFactory));
router.get("/", asyncHandler(listFactories));
router.get("/:factoryId", requireFactoryOwner, asyncHandler(getFactoryById));
router.put("/:factoryId", requireFactoryOwner, validate(updateFactorySchema), asyncHandler(updateFactory));

router.post("/:factoryId/workers", requireFactoryOwner, validate(createWorkerSchema), asyncHandler(createWorker));
router.get("/:factoryId/workers", requireFactoryOwner, asyncHandler(listWorkers));
router.get("/:factoryId/workers/:workerId", requireFactoryOwner, asyncHandler(getWorkerById));
router.put("/:factoryId/workers/:workerId", requireFactoryOwner, validate(updateWorkerSchema), asyncHandler(updateWorker));
router.delete("/:factoryId/workers/:workerId", requireFactoryOwner, asyncHandler(deleteWorker));

router.post("/:factoryId/transactions/handoff", requireFactoryOwner, validate(createHandoffSchema), asyncHandler(createHandoff));
router.post("/:factoryId/transactions/direct", requireFactoryOwner, validate(createDirectSchema), asyncHandler(createDirect));
router.post("/:factoryId/transactions/truck-distribution", requireFactoryOwner, validate(createTruckDistSchema), asyncHandler(createTruckDistribution));
router.post("/:factoryId/transactions/money-given", requireFactoryOwner, validate(createMoneyGivenSchema), asyncHandler(createMoneyGiven));
router.get("/:factoryId/transactions", requireFactoryOwner, asyncHandler(listTransactions));
router.get("/:factoryId/transactions/:transactionId", requireFactoryOwner, asyncHandler(getTransactionById));
router.get("/:factoryId/workers/:workerId/transactions", requireFactoryOwner, asyncHandler(getWorkerTransactions));

router.get("/:factoryId/workers/:workerId/summary", requireFactoryOwner, asyncHandler(getWorkerSummary));
router.get("/:factoryId/summary", requireFactoryOwner, asyncHandler(getFactorySummary));

export default router;
