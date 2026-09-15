import { afterAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { hashToken } from "../src/services/tokens.js";
import { app, closeDb, data, expectStatus, pool, signup, uniqueEmail } from "./helpers.js";

afterAll(closeDb);

const refresh = (refresh_token) => request(app).post("/v1/auth/refresh").send({ refresh_token });

describe("auth", () => {
  it("signs up with a salted scrypt hash and rejects a duplicate email", async () => {
    const email = uniqueEmail();
    const session = await signup({ email: email.toUpperCase() });

    expect(session.user.email).toBe(email);
    expect(session.user).not.toHaveProperty("password_hash");
    expect(session.access_token).toBeTruthy();

    const {
      rows: [row],
    } = await pool.query("SELECT password_hash FROM users WHERE email = $1", [email]);
    expect(row.password_hash).toMatch(/^scrypt\$/);

    const duplicate = await request(app)
      .post("/v1/auth/signup")
      .send({ name: "Again", email, password: "password123" });
    expect(duplicate.status).toBe(409);
  });

  it("validates signup input", async () => {
    const res = await request(app)
      .post("/v1/auth/signup")
      .send({ name: "", email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("logs in only with the right password", async () => {
    const { user } = await signup();

    const wrong = await request(app).post("/v1/auth/login").send({ email: user.email, password: "wrong-password" });
    expect(wrong.status).toBe(401);

    const unknown = await request(app)
      .post("/v1/auth/login")
      .send({ email: uniqueEmail(), password: "password123" });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe(wrong.body.message);

    const login = expectStatus(
      await request(app).post("/v1/auth/login").send({ email: user.email, password: "password123" }),
      200,
    );
    const me = await request(app).get("/v1/auth/me").set("Authorization", `Bearer ${data(login).access_token}`);
    expect(data(me).id).toBe(user.id);
  });

  it("rotates refresh tokens and ends the chain when an old token is reused", async () => {
    const { refresh_token: original } = await signup();

    const rotated = data(expectStatus(await refresh(original), 200)).refresh_token;
    expect(rotated).not.toBe(original);

    // A quick retry of the old token (e.g. two app requests racing) is only refused.
    expect((await refresh(original)).status).toBe(401);

    // Reused well after rotation, it looks stolen: the whole chain is revoked.
    await pool.query("UPDATE refresh_tokens SET revoked_at = now() - interval '5 minutes' WHERE token_hash = $1", [
      hashToken(original),
    ]);
    expect((await refresh(original)).status).toBe(401);
    expect((await refresh(rotated)).status).toBe(401);
  });

  it("logs out of all devices", async () => {
    const first = await signup();
    const second = data(
      expectStatus(
        await request(app).post("/v1/auth/login").send({ email: first.user.email, password: "password123" }),
        200,
      ),
    );

    expectStatus(
      await request(app).post("/v1/auth/logout").send({ refresh_token: first.refresh_token, all_devices: true }),
      200,
    );
    expect((await refresh(first.refresh_token)).status).toBe(401);
    expect((await refresh(second.refresh_token)).status).toBe(401);
  });

  it("returns 403 for suspended users", async () => {
    const { user, auth } = await signup();
    await pool.query("UPDATE users SET is_active = false WHERE id = $1", [user.id]);

    expect((await request(app).get("/v1/auth/me").set(auth)).status).toBe(403);
    const login = await request(app).post("/v1/auth/login").send({ email: user.email, password: "password123" });
    expect(login.status).toBe(403);
  });

  it("changing the password signs out other sessions", async () => {
    const { user, auth, refresh_token } = await signup();

    const wrongCurrent = await request(app)
      .post("/v1/auth/me/password")
      .set(auth)
      .send({ current_password: "nope-nope", new_password: "new-password-1" });
    expect(wrongCurrent.status).toBe(400);

    const changed = expectStatus(
      await request(app)
        .post("/v1/auth/me/password")
        .set(auth)
        .send({ current_password: "password123", new_password: "new-password-1" }),
      200,
    );
    expect(data(changed).refresh_token).toBeTruthy();
    expect((await refresh(refresh_token)).status).toBe(401);

    const login = await request(app).post("/v1/auth/login").send({ email: user.email, password: "new-password-1" });
    expect(login.status).toBe(200);
  });

  it("rejects missing, malformed and expired-looking access tokens", async () => {
    expect((await request(app).get("/v1/auth/me")).status).toBe(401);
    expect((await request(app).get("/v1/auth/me").set("Authorization", "Bearer abc.def.ghi")).status).toBe(401);
  });
});
