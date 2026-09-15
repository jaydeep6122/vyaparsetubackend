import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../../middlewares/auth.middlewares.js";
import { idParams } from "../../middlewares/params.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { context, ok } from "../../utils/http.js";
import { date, dateRangeQuery, id, queryBoolean } from "../../utils/schemas.js";
import * as reports from "./reports.service.js";

const router = Router({ mergeParams: true });

// Stock levels are needed at the counter; everything else is for accounts staff.
router.get(
  "/stock-summary",
  validate(z.object({ search: z.string().trim().max(100).optional(), low_stock: queryBoolean.optional() }), "query"),
  async (req, res) => {
    ok(res, await reports.stockSummary(context(req), req.query));
  },
);

router.use(requireRole("accountant"));

router.get("/dashboard", validate(dateRangeQuery(), "query"), async (req, res) => {
  ok(res, await reports.dashboard(context(req), req.query));
});

router.get("/profit-loss", validate(dateRangeQuery(), "query"), async (req, res) => {
  ok(res, await reports.profitLoss(context(req), req.query));
});

router.get("/gst-summary", validate(dateRangeQuery(), "query"), async (req, res) => {
  ok(res, await reports.gstSummary(context(req), req.query));
});

router.get(
  "/outstanding",
  validate(z.object({ type: z.enum(["receivable", "payable"]).optional(), party_id: id.optional() }), "query"),
  async (req, res) => {
    ok(res, await reports.outstanding(context(req), req.query));
  },
);

router.get("/day-book", validate(z.object({ date: date.optional() }), "query"), async (req, res) => {
  ok(res, await reports.dayBook(context(req), req.query));
});

router.get(
  "/party-ledger/:partyId",
  idParams("partyId"),
  validate(dateRangeQuery(), "query"),
  async (req, res) => {
    ok(res, await reports.partyLedger(context(req), req.params.partyId, req.query));
  },
);

router.get(
  "/account-book/:accountId",
  idParams("accountId"),
  validate(dateRangeQuery(), "query"),
  async (req, res) => {
    ok(res, await reports.accountBook(context(req), req.params.accountId, req.query));
  },
);

export default router;
