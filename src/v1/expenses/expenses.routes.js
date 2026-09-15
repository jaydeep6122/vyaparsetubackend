import { Router } from "express";
import pool from "../../db/db.js";
import { requireRole } from "../../middlewares/auth.middlewares.js";
import { idParams } from "../../middlewares/params.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { context, created, ok, paged } from "../../utils/http.js";
import { cancelSchema } from "../payments/payments.schemas.js";
import * as schemas from "./expenses.schemas.js";
import * as service from "./expenses.service.js";

const router = Router({ mergeParams: true });

router.get("/", validate(schemas.listExpensesQuery, "query"), async (req, res) => {
  paged(res, await service.listExpenses(context(req), req.query));
});

router.post("/", validate(schemas.createExpenseSchema), async (req, res) => {
  created(res, await service.createExpense(context(req), req.body));
});

router.get("/:expenseId", idParams("expenseId"), async (req, res) => {
  ok(res, await service.getExpense(pool, req.business.id, req.params.expenseId));
});

router.put(
  "/:expenseId",
  requireRole("accountant"),
  idParams("expenseId"),
  validate(schemas.updateExpenseSchema),
  async (req, res) => {
    ok(res, await service.updateExpense(context(req), req.params.expenseId, req.body));
  },
);

router.post(
  "/:expenseId/cancel",
  requireRole("accountant"),
  idParams("expenseId"),
  validate(cancelSchema),
  async (req, res) => {
    ok(res, await service.cancelExpense(context(req), req.params.expenseId, req.body.reason));
  },
);

export default router;
