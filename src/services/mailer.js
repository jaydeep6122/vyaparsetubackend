import nodemailer from "nodemailer";
import logger from "../utils/logger.js";

/** Emails "sent" while NODE_ENV=test, so tests can read them. */
export const outbox = [];

let transport;

function smtpTransport() {
  if (transport === undefined) {
    transport = process.env.SMTP_HOST
      ? nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === "true",
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
        })
      : null;
  }
  return transport;
}

export const isMailConfigured = () =>
  process.env.NODE_ENV === "test" || Boolean(process.env.SMTP_HOST);

/**
 * Sends one email and resolves to `{ delivered }`.
 *
 * In tests the message only lands in `outbox`. Without SMTP settings nothing
 * is sent: development logs a preview (so reset codes can be used locally),
 * production logs an error.
 */
export async function sendMail({ to, subject, text, attachments = [] }) {
  if (process.env.NODE_ENV === "test") {
    outbox.push({ to, subject, text, attachments });
    return { delivered: true };
  }

  const smtp = smtpTransport();
  if (!smtp) {
    if (process.env.NODE_ENV === "production") {
      logger.error(`[Mail] SMTP is not configured; could not send "${subject}" to ${to}`);
    } else {
      logger.warn(`[Mail] SMTP is not configured. Preview of "${subject}" to ${to}:\n${text}`);
    }
    return { delivered: false };
  }

  await smtp.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    attachments,
  });
  return { delivered: true };
}
