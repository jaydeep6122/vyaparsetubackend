import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { outbox } from "../src/services/mailer.js";
import { app, closeDb, data, expectStatus, pool, signup, uniqueEmail } from "./helpers.js";

afterAll(closeDb);
beforeEach(() => {
  outbox.length = 0;
});

const forgot = (email) => request(app).post("/v1/auth/password/forgot").send({ email });
const reset = (body) => request(app).post("/v1/auth/password/reset").send(body);
const codeIn = (mail) => mail.text.match(/\b(\d{6})\b/)[1];

describe("forgot password", () => {
  it("answers the same way for an unknown email and sends nothing", async () => {
    const res = expectStatus(await forgot(uniqueEmail()), 200);
    expect(data(res).message).toMatch(/If an account exists/);
    expect(outbox).toHaveLength(0);
  });

  it("resets the password with the emailed code and signs out every session", async () => {
    const { user, refresh_token } = await signup();

    expectStatus(await forgot(user.email), 200);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(user.email);
    const code = codeIn(outbox[0]);

    // Asking again within a minute does not send another code.
    expectStatus(await forgot(user.email), 200);
    expect(outbox).toHaveLength(1);

    const session = data(expectStatus(await reset({ email: user.email, code, new_password: "brand-new-pass" }), 200));
    expect(session.access_token).toBeTruthy();

    expect((await request(app).post("/v1/auth/refresh").send({ refresh_token })).status).toBe(401);
    const login = await request(app).post("/v1/auth/login").send({ email: user.email, password: "brand-new-pass" });
    expect(login.status).toBe(200);

    // A code works once.
    expect((await reset({ email: user.email, code, new_password: "another-pass-1" })).status).toBe(400);
  });

  it("stops accepting the code after five wrong attempts", async () => {
    const { user } = await signup();
    await forgot(user.email);
    const code = codeIn(outbox[0]);
    const wrong = code === "000000" ? "111111" : "000000";

    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await reset({ email: user.email, code: wrong, new_password: "brand-new-pass" })).status).toBe(400);
    }
    expect((await reset({ email: user.email, code, new_password: "brand-new-pass" })).status).toBe(400);
  });

  it("rejects an expired code", async () => {
    const { user } = await signup();
    await forgot(user.email);
    await pool.query("UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [user.id]);

    expect((await reset({ email: user.email, code: codeIn(outbox[0]), new_password: "brand-new-pass" })).status).toBe(400);
  });

  it("validates the reset request", async () => {
    expect((await reset({ email: "someone@example.com", code: "12ab", new_password: "brand-new-pass" })).status).toBe(400);
    expect((await reset({ email: "someone@example.com", code: "123456", new_password: "short" })).status).toBe(400);
  });
});
