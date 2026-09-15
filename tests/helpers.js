import request from "supertest";
import app from "../src/app.js";
import pool from "../src/db/db.js";

let sequence = 0;

export const uniqueEmail = () =>
  `user${Date.now()}${sequence++}${Math.random().toString(36).slice(2, 7)}@example.com`;

export const data = (res) => res.body.data;

export function expectStatus(res, status) {
  if (res.status !== status) {
    throw new Error(`Expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res;
}

export async function signup(overrides = {}) {
  const res = await request(app)
    .post("/v1/auth/signup")
    .send({ name: "Test User", email: uniqueEmail(), password: "password123", ...overrides });
  expectStatus(res, 201);

  const { user, access_token, refresh_token } = data(res);
  return { user, access_token, refresh_token, auth: { Authorization: `Bearer ${access_token}` } };
}

/** A regular GST business in Gujarat (state 24) with ₹10,000 opening cash. */
export async function createBusiness(auth, overrides = {}) {
  const res = await request(app)
    .post("/v1/businesses")
    .set(auth)
    .send({
      name: "Shree Traders",
      gst_registration_type: "regular",
      gstin: "24ABCDE1234F1Z5",
      state_code: "24",
      opening_cash_balance: 10000,
      ...overrides,
    });
  return data(expectStatus(res, 201));
}

/**
 * Request helper scoped to one business: `biz.post("/parties", body, 201)`.
 * The optional last argument asserts the status.
 */
export function bizClient(auth, businessId) {
  const call = (method) => async (path, body, expected) => {
    let req = request(app)[method](`/v1/businesses/${businessId}${path}`).set(auth);
    if (body !== undefined) req = method === "get" ? req.query(body) : req.send(body);
    const res = await req;
    return expected === undefined ? res : expectStatus(res, expected);
  };
  return { get: call("get"), post: call("post"), patch: call("patch"), put: call("put"), del: call("delete") };
}

export { app, pool };
export const closeDb = () => pool.end();
