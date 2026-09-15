import { Router } from "express";
import pool from "../../db/db.js";
import { requireRole } from "../../middlewares/auth.middlewares.js";
import { idParams } from "../../middlewares/params.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { context, created, ok, paged } from "../../utils/http.js";
import { dateRangeQuery } from "../../utils/schemas.js";
import { partyLedger } from "../reports/reports.service.js";
import * as schemas from "./parties.schemas.js";
import * as service from "./parties.service.js";

const router = Router({ mergeParams: true });

router.get("/", validate(schemas.listPartiesQuery, "query"), async (req, res) => {
  paged(res, await service.listParties(context(req), req.query));
});

router.post("/", validate(schemas.createPartySchema), async (req, res) => {
  created(res, await service.createParty(context(req), req.body));
});

router.get("/:partyId", idParams("partyId"), async (req, res) => {
  ok(res, await service.getParty(pool, req.business.id, req.params.partyId));
});

router.patch("/:partyId", idParams("partyId"), validate(schemas.updatePartySchema), async (req, res) => {
  ok(res, await service.updateParty(context(req), req.params.partyId, req.body));
});

router.post("/:partyId/archive", requireRole("accountant"), idParams("partyId"), async (req, res) => {
  ok(res, await service.setPartyArchived(context(req), req.params.partyId, true));
});

router.post("/:partyId/restore", requireRole("accountant"), idParams("partyId"), async (req, res) => {
  ok(res, await service.setPartyArchived(context(req), req.params.partyId, false));
});

router.get(
  "/:partyId/ledger",
  requireRole("accountant"),
  idParams("partyId"),
  validate(dateRangeQuery(), "query"),
  async (req, res) => {
    ok(res, await partyLedger(context(req), req.params.partyId, req.query));
  },
);

export default router;
