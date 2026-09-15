/** Every successful response is `{ success: true, data, ...extra }`. */
export const ok = (res, data, status = 200, extra = {}) =>
  res.status(status).json({ success: true, data, ...extra });

export const created = (res, data) => ok(res, data, 201);

export const paged = (res, { rows, pagination }) =>
  ok(res, rows, 200, { pagination });

export function sendPdf(res, fileName, pdf, { download = false } = {}) {
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
    "Content-Length": pdf.length,
    "Cache-Control": "private, no-store",
  });
  res.end(pdf);
}

/** Base URL for links sent to people outside the app. */
export const publicBaseUrl = (req) =>
  (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");

/** What services need to know about the caller and the business. */
export const context = (req) => ({
  business: req.business,
  user: req.user,
  role: req.role,
});
