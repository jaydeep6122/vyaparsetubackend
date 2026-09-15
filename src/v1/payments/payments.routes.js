import { Router } from "express";
import pool from "../../db/db.js";
import { requireRole } from "../../middlewares/auth.middlewares.js";
import { idParams } from "../../middlewares/params.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { context, created, ok, paged } from "../../utils/http.js";
import * as schemas from "./payments.schemas.js";
import * as service from "./payments.service.js";

const router = Router({ mergeParams: true });

router.get("/", validate(schemas.listPaymentsQuery, "query"), async (req, res) => {
  paged(res, await service.listPayments(context(req), req.query));
});

router.post("/", validate(schemas.createPaymentSchema), async (req, res) => {
  created(res, await service.createPayment(context(req), req.body));
});

router.get("/:paymentId", idParams("paymentId"), async (req, res) => {
  ok(res, await service.getPayment(pool, req.business.id, req.params.paymentId));
});

router.put(
  "/:paymentId",
  requireRole("accountant"),
  idParams("paymentId"),
  validate(schemas.updatePaymentSchema),
  async (req, res) => {
    ok(res, await service.updatePayment(context(req), req.params.paymentId, req.body));
  },
);

router.post(
  "/:paymentId/cancel",
  requireRole("accountant"),
  idParams("paymentId"),
  validate(schemas.cancelSchema),
  async (req, res) => {
    ok(res, await service.cancelPayment(context(req), req.params.paymentId, req.body.reason));
  },
);

export default router;
