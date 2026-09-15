import { Router } from "express";
import pool from "../../db/db.js";
import { requireRole } from "../../middlewares/auth.middlewares.js";
import { idParams } from "../../middlewares/params.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { context, created, ok, paged, publicBaseUrl, sendPdf } from "../../utils/http.js";
import { cancelSchema } from "../payments/payments.schemas.js";
import * as documents from "./invoices.documents.js";
import * as schemas from "./invoices.schemas.js";
import * as service from "./invoices.service.js";

const router = Router({ mergeParams: true });

router.get("/", validate(schemas.listInvoicesQuery, "query"), async (req, res) => {
  paged(res, await service.listInvoices(context(req), req.query));
});

router.post("/", validate(schemas.createInvoiceSchema), async (req, res) => {
  created(res, await service.createInvoice(context(req), req.body));
});

router.get("/:invoiceId", idParams("invoiceId"), async (req, res) => {
  ok(res, await service.getInvoice(pool, req.business.id, req.params.invoiceId));
});

router.put(
  "/:invoiceId",
  requireRole("accountant"),
  idParams("invoiceId"),
  validate(schemas.updateInvoiceSchema),
  async (req, res) => {
    ok(res, await service.updateInvoice(context(req), req.params.invoiceId, req.body));
  },
);

router.post(
  "/:invoiceId/cancel",
  requireRole("accountant"),
  idParams("invoiceId"),
  validate(cancelSchema),
  async (req, res) => {
    ok(res, await service.cancelInvoice(context(req), req.params.invoiceId, req.body.reason));
  },
);

router.get("/:invoiceId/pdf", idParams("invoiceId"), validate(schemas.pdfQuery, "query"), async (req, res) => {
  const { fileName, pdf } = await documents.invoicePdf(req.business.id, req.params.invoiceId);
  sendPdf(res, fileName, pdf, { download: req.query.download });
});

router.post("/:invoiceId/share", idParams("invoiceId"), async (req, res) => {
  ok(res, await documents.shareInvoice(context(req), req.params.invoiceId, publicBaseUrl(req)));
});

router.post("/:invoiceId/email", idParams("invoiceId"), validate(schemas.emailInvoiceSchema), async (req, res) => {
  ok(res, await documents.emailInvoice(context(req), req.params.invoiceId, req.body));
});

router.delete("/:invoiceId", idParams("invoiceId"), async (req, res) => {
  await service.deleteDraft(context(req), req.params.invoiceId);
  ok(res, { deleted: true });
});

export default router;
