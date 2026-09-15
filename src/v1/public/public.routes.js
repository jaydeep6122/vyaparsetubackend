import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middlewares/validation.middlewares.js";
import { sendPdf } from "../../utils/http.js";
import { queryBoolean } from "../../utils/schemas.js";
import { publicInvoicePdf } from "../invoices/invoices.documents.js";

const router = Router();

// Opened from share links (WhatsApp, SMS) without logging in. Access comes
// only from the signed token in the URL.
router.get(
  "/invoices/:token",
  validate(z.object({ download: queryBoolean.optional() }), "query"),
  async (req, res) => {
    const { fileName, pdf } = await publicInvoicePdf(req.params.token);
    res.set("X-Robots-Tag", "noindex, nofollow");
    sendPdf(res, fileName, pdf, { download: req.query.download });
  },
);

export default router;
