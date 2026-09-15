import pool from "../../db/db.js";
import { audit } from "../../services/audit.js";
import { invoiceTitle, renderInvoicePdf } from "../../services/invoice-pdf.js";
import { isMailConfigured, sendMail } from "../../services/mailer.js";
import { signShareToken, verifyShareToken } from "../../services/tokens.js";
import { ApiError } from "../../utils/ApiError.js";
import { formatDate, formatINR } from "../../utils/format.js";
import { getInvoice } from "./invoices.service.js";

const SHARE_LINK_DAYS = 30;

async function loadDocument(businessId, invoiceId) {
  const {
    rows: [business],
  } = await pool.query("SELECT * FROM businesses WHERE id = $1 AND archived_at IS NULL", [businessId]);
  if (!business) throw new ApiError(404, "Invoice not found");

  const invoice = await getInvoice(pool, businessId, invoiceId);
  const {
    rows: [bankAccount],
  } = await pool.query(
    `SELECT bank_name, account_number, ifsc, upi_id FROM accounts
     WHERE business_id = $1 AND account_type = 'bank' AND archived_at IS NULL
     ORDER BY is_default DESC, created_at
     LIMIT 1`,
    [businessId],
  );
  const {
    rows: [party],
  } = invoice.party_id
    ? await pool.query("SELECT phone, email FROM parties WHERE id = $1", [invoice.party_id])
    : { rows: [] };

  return { business, invoice, bankAccount, party };
}

export const pdfFileName = (invoice) => `${invoice.invoice_number.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;

export async function invoicePdf(businessId, invoiceId) {
  const document = await loadDocument(businessId, invoiceId);
  return { fileName: pdfFileName(document.invoice), pdf: await renderInvoicePdf(document) };
}

/** wa.me wants the number with country code and no symbols; 10-digit numbers are Indian. */
function whatsappNumber(phone) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits.length >= 11 ? digits : "";
}

const summary = (business, invoice) =>
  `${invoiceTitle(invoice)} ${invoice.invoice_number} dated ${formatDate(invoice.invoice_date)} ` +
  `for Rs. ${formatINR(invoice.total_amount)}`;

/**
 * A signed link anyone can open to view the PDF, e.g. from WhatsApp. It works
 * until it expires or the invoice/business is removed; it cannot be revoked
 * individually.
 */
export async function shareInvoice(ctx, invoiceId, baseUrl) {
  const { business, invoice, party } = await loadDocument(ctx.business.id, invoiceId);
  if (invoice.status === "draft") throw new ApiError(400, "Finalise the invoice before sharing it");

  const token = signShareToken(
    { invoice_id: invoice.id, business_id: business.id },
    SHARE_LINK_DAYS * 24 * 60 * 60,
  );
  const url = `${baseUrl}/v1/public/invoices/${token}`;
  const message = `${business.name}: ${summary(business, invoice)}. View or download: ${url}`;

  return {
    url,
    expires_at: new Date(Date.now() + SHARE_LINK_DAYS * 86_400_000).toISOString(),
    message,
    whatsapp_url: `https://wa.me/${whatsappNumber(party?.phone)}?text=${encodeURIComponent(message)}`,
  };
}

export async function emailInvoice(ctx, invoiceId, { to, message }) {
  const document = await loadDocument(ctx.business.id, invoiceId);
  const { business, invoice, party } = document;

  if (invoice.status === "draft") throw new ApiError(400, "Finalise the invoice before emailing it");
  const recipient = to ?? party?.email;
  if (!recipient) throw new ApiError(400, "The party has no email address; send `to` with the request");
  if (!isMailConfigured()) throw new ApiError(503, "Email is not configured on this server");

  const pdf = await renderInvoicePdf(document);
  await sendMail({
    to: recipient,
    subject: `${invoiceTitle(invoice)} ${invoice.invoice_number} from ${business.name}`,
    text: [message, `Please find attached ${summary(business, invoice)}.`, business.name].filter(Boolean).join("\n\n"),
    attachments: [{ filename: pdfFileName(invoice), content: pdf, contentType: "application/pdf" }],
  });
  await audit(pool, {
    businessId: business.id,
    userId: ctx.user.id,
    action: "email",
    entityType: "invoice",
    entityId: invoice.id,
    after: { to: recipient },
  });
  return { sent_to: recipient };
}

export async function publicInvoicePdf(token) {
  const payload = verifyShareToken(token);
  if (!payload?.invoice_id || !payload?.business_id) {
    throw new ApiError(404, "This link is invalid or has expired");
  }
  return invoicePdf(payload.business_id, payload.invoice_id);
}
