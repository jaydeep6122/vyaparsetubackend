import { Router } from "express";
import pool from "../../db/db.js";
import { requireRole } from "../../middlewares/auth.middlewares.js";
import { idParams } from "../../middlewares/params.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { context, created, ok } from "../../utils/http.js";
import { dateRangeQuery } from "../../utils/schemas.js";
import { accountBook } from "../reports/reports.service.js";
import * as schemas from "./accounts.schemas.js";
import * as service from "./accounts.service.js";

const router = Router({ mergeParams: true });

router.get("/", validate(schemas.listAccountsQuery, "query"), async (req, res) => {
  ok(res, await service.listAccounts(context(req), req.query));
});

router.post("/", requireRole("admin"), validate(schemas.createAccountSchema), async (req, res) => {
  created(res, await service.createAccount(context(req), req.body));
});

router.get("/:accountId", idParams("accountId"), async (req, res) => {
  ok(res, await service.getAccount(pool, req.business.id, req.params.accountId));
});

router.patch(
  "/:accountId",
  requireRole("admin"),
  idParams("accountId"),
  validate(schemas.updateAccountSchema),
  async (req, res) => {
    ok(res, await service.updateAccount(context(req), req.params.accountId, req.body));
  },
);

router.post("/:accountId/archive", requireRole("admin"), idParams("accountId"), async (req, res) => {
  ok(res, await service.setAccountArchived(context(req), req.params.accountId, true));
});

router.post("/:accountId/restore", requireRole("admin"), idParams("accountId"), async (req, res) => {
  ok(res, await service.setAccountArchived(context(req), req.params.accountId, false));
});

router.get(
  "/:accountId/book",
  requireRole("accountant"),
  idParams("accountId"),
  validate(dateRangeQuery(), "query"),
  async (req, res) => {
    ok(res, await accountBook(context(req), req.params.accountId, req.query));
  },
);

export default router;
