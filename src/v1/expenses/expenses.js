import express from "express";
import { createExpense } from "./create/create.controllers.js";
import { listExpenses, getExpenseById } from "./read/read.controllers.js";
import { updateExpense } from "./update/update.controllers.js";
import { deleteExpense } from "./delete/delete.controllers.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { createExpenseSchema, updateExpenseSchema } from "../../utils/validators.js";

const router = express.Router({ mergeParams: true });

router.post("/", validate(createExpenseSchema), asyncHandler(createExpense));
router.get("/", asyncHandler(listExpenses));
router.get("/:expenseId", asyncHandler(getExpenseById));
router.put("/:expenseId", validate(updateExpenseSchema), asyncHandler(updateExpense));
router.delete("/:expenseId", asyncHandler(deleteExpense));

export default router;
