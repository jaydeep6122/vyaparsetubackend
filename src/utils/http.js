/** Every successful response is `{ success: true, data, ...extra }`. */
export const ok = (res, data, status = 200, extra = {}) =>
  res.status(status).json({ success: true, data, ...extra });

export const created = (res, data) => ok(res, data, 201);

export const paged = (res, { rows, pagination }) =>
  ok(res, rows, 200, { pagination });

/** What services need to know about the caller and the business. */
export const context = (req) => ({
  business: req.business,
  user: req.user,
  role: req.role,
});
