import express from "express";
import { createExpense } from "./create/create.controllers.js";
import { listExpenses, getExpenseById } from "./read/read.controllers.js";
import { updateExpense } from "./update/update.controllers.js";
import { deleteExpense } from "./delete/delete.controllers.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const router = express.Router({ mergeParams: true });

router.post("/", asyncHandler(createExpense));
router.get("/", asyncHandler(listExpenses));
router.get("/:expenseId", asyncHandler(getExpenseById));
router.put("/:expenseId", asyncHandler(updateExpense));
router.delete("/:expenseId", asyncHandler(deleteExpense));

export default router;
