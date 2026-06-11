import { describe, it, expect, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../src/app.js";
import pool from "../../src/db/db.js";

describe("Auth Integration Tests", () => {
  const testEmails = [];

  afterAll(async () => {
    if (testEmails.length > 0) {
      await pool.query("DELETE FROM users WHERE email = ANY($1)", [testEmails]);
    }
    // Close the pool connections so Jest can exit cleanly
    await pool.end();
  });

  const generateEmail = () => {
    const email = `test_user_${Math.random().toString(36).substring(2, 11)}@example.com`;
    testEmails.push(email);
    return email;
  };

  describe("POST /v1/auth/signup", () => {
    it("should sign up a user successfully with valid details", async () => {
      const email = generateEmail();
      const res = await request(app)
        .post("/v1/auth/signup")
        .send({
          name: "Test User",
          email: email,
          password: "password123",
          confirmPassword: "password123"
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("refreshToken");
      expect(res.body.user).toHaveProperty("id");
      expect(res.body.user.email).toBe(email);
      expect(res.body.user).not.toHaveProperty("password");
    });

    it("should fail signup if password and confirmPassword do not match", async () => {
      const res = await request(app)
        .post("/v1/auth/signup")
        .send({
          name: "Test User Match Failure",
          email: `fail_${Math.random().toString(36).substring(2, 8)}@example.com`,
          password: "password123",
          confirmPassword: "password321"
        });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/auth/login", () => {
    it("should login successfully with correct credentials", async () => {
      const email = generateEmail();
      // First signup
      await request(app)
        .post("/v1/auth/signup")
        .send({
          name: "Login User",
          email: email,
          password: "password123",
          confirmPassword: "password123"
        });

      // Then login
      const res = await request(app)
        .post("/v1/auth/login")
        .send({
          email: email,
          password: "password123"
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("refreshToken");
    });

    it("should fail login with incorrect password", async () => {
      const email = generateEmail();
      await request(app)
        .post("/v1/auth/signup")
        .send({
          name: "Login Fail User",
          email: email,
          password: "password123",
          confirmPassword: "password123"
        });

      const res = await request(app)
        .post("/v1/auth/login")
        .send({
          email: email,
          password: "wrongpassword"
        });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/auth/me", () => {
    it("should fetch current user data when authenticated", async () => {
      const email = generateEmail();
      const signupRes = await request(app)
        .post("/v1/auth/signup")
        .send({
          name: "Me User",
          email: email,
          password: "password123",
          confirmPassword: "password123"
        });

      const token = signupRes.body.accessToken;

      const res = await request(app)
        .get("/v1/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.user.email).toBe(email);
    });

    it("should fail if no token is provided", async () => {
      const res = await request(app).get("/v1/auth/me");
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /v1/auth/refresh", () => {
    it("should generate new tokens with valid refresh token", async () => {
      const email = generateEmail();
      const signupRes = await request(app)
        .post("/v1/auth/signup")
        .send({
          name: "Refresh User",
          email: email,
          password: "password123",
          confirmPassword: "password123"
        });

      const { refreshToken } = signupRes.body;

      const res = await request(app)
        .post("/v1/auth/refresh")
        .send({ refresh_token: refreshToken });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("refreshToken");
    });
  });

  describe("POST /v1/auth/logout", () => {
    it("should logout successfully and revoke the refresh token", async () => {
      const email = generateEmail();
      const signupRes = await request(app)
        .post("/v1/auth/signup")
        .send({
          name: "Logout User",
          email: email,
          password: "password123",
          confirmPassword: "password123"
        });

      const { refreshToken } = signupRes.body;

      const res = await request(app)
        .post("/v1/auth/logout")
        .send({ refresh_token: refreshToken });

      expect(res.statusCode).toBe(200);

      // Verify the token is revoked by attempting to refresh with it
      const refreshRes = await request(app)
        .post("/v1/auth/refresh")
        .send({ refresh_token: refreshToken });

      expect(refreshRes.statusCode).toBe(403);
    });
  });
});
