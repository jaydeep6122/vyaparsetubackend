import express from "express";
import { createFactory } from "./create/create.controllers.js";
import { listFactories, getFactoryById } from "./read/read.controllers.js";
import workersRouter from "./workers/workers.js";
import workLogsRouter from "./work-logs/work-logs.js";
import transactionsRouter from "./transactions/transactions.js";
import settlementsRouter from "./settlements/settlements.js";
import { requireAuth, requireFactoryOwner } from "../../middlewares/auth.middlewares.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { createKilnFactorySchema } from "../../utils/validators.js";

const router = express.Router();

// Apply authentication middleware to all factory actions
router.use(requireAuth);

router.post("/", validate(createKilnFactorySchema), asyncHandler(createFactory));
router.get("/", asyncHandler(listFactories));
router.get("/:factoryId", requireFactoryOwner, asyncHandler(getFactoryById));

// Nested resources for an independent factory
router.use("/:factoryId/workers", requireFactoryOwner, workersRouter);
router.use("/:factoryId/work-logs", requireFactoryOwner, workLogsRouter);
router.use("/:factoryId/transactions", requireFactoryOwner, transactionsRouter);
router.use("/:factoryId/settlements", requireFactoryOwner, settlementsRouter);

export default router;
