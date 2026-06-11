import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../src/app.js";
import pool from "../../src/db/db.js";

describe("Businesses Integration Tests", () => {
  let token;
  let testUserEmail;
  let testUserId;
  let createdBusinessId;

  beforeAll(async () => {
    testUserEmail = `biz_user_${Math.random().toString(36).substring(2, 11)}@example.com`;
    // Register user
    const signupRes = await request(app).post("/v1/auth/signup").send({
      name: "Business Owner",
      email: testUserEmail,
      password: "password123",
      confirmPassword: "password123",
    });
    token = signupRes.body.accessToken;
    testUserId = signupRes.body.user.id;
  });

  afterAll(async () => {
    if (testUserId) {
      await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
    }
    await pool.end();
  });

  const generateGSTIN = () => {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const randLetters = Array.from(
      { length: 5 },
      () => letters[Math.floor(Math.random() * 26)],
    ).join("");
    return `27${randLetters}1234A1Z1`;
  };

  describe("POST /v1/businesses", () => {
    it("should create a new business successfully", async () => {
      const gstin = generateGSTIN();
      const res = await request(app)
        .post("/v1/businesses")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Test Retailer Business",
          address: "123 Market St",
          city: "Pune",
          state: "Maharashtra",
          pincode: "411001",
          gstin: gstin,
          business_type: "retailer",
          invoice_prefix: "RET",
          financial_year: "2026-2027",
        });

      // The controller sends 204 status code (no content) for creation
      expect(res.statusCode).toBe(204);
    });

    it("should fail to create business with invalid details", async () => {
      const res = await request(app)
        .post("/v1/businesses")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "", // Invalid name
          business_type: "invalid_type",
        });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/businesses", () => {
    it("should list all businesses for the authenticated user", async () => {
      const res = await request(app)
        .get("/v1/businesses")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      createdBusinessId = res.body[0].id;
    });
  });

  describe("GET /v1/businesses/:businessId", () => {
    it("should retrieve business details by ID", async () => {
      const res = await request(app)
        .get(`/v1/businesses/${createdBusinessId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Test Retailer Business");
    });
  });

  describe("PUT /v1/businesses/:businessId", () => {
    it("should update business details successfully", async () => {
      const res = await request(app)
        .put(`/v1/businesses/${createdBusinessId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Updated Retailer Business",
          city: "Mumbai",
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Updated Retailer Business");
      expect(res.body.city).toBe("Mumbai");
    });
  });

  describe("DELETE /v1/businesses/:businessId", () => {
    it("should delete the business profile successfully", async () => {
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const getRandLetter = () =>
        letters[Math.floor(Math.random() * letters.length)];
      const tempGstin = `27${getRandLetter()}${getRandLetter()}${getRandLetter()}${getRandLetter()}${getRandLetter()}2222B2Z2`;
      await pool.query(
        `INSERT INTO businesses (user_id, name, address, city, state, pincode, gstin, business_type, invoice_prefix, financial_year)
         VALUES ($1, 'Temp Biz', 'Addr', 'City', 'State', '123', $2, 'retailer', 'TMP', '2026')`,
        [testUserId, tempGstin],
      );

      const listRes = await request(app)
        .get("/v1/businesses")
        .set("Authorization", `Bearer ${token}`);

      const tempBiz = listRes.body.find((b) => b.name === "Temp Biz");
      expect(tempBiz).toBeDefined();

      const deleteRes = await request(app)
        .delete(`/v1/businesses/${tempBiz.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(deleteRes.statusCode).toBe(204);

      // Verify it's gone
      const verifyRes = await request(app)
        .get(`/v1/businesses/${tempBiz.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(verifyRes.statusCode).toBe(403);
    });
  });

  describe("Parties Integration Tests", () => {
    it("should create a party with optional email/phone and multiple shipping addresses", async () => {
      const res = await request(app)
        .post(`/v1/businesses/${createdBusinessId}/parties`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Test Party",
          phone: "",
          email: "",
          shipping_address: ["123 Lane A", "456 Lane B"],
          party_type: "customer",
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.name).toBe("Test Party");
      expect(res.body.email).toBeNull();
      expect(res.body.shipping_address).toEqual(["123 Lane A", "456 Lane B"]);
    });

    it("should update a party successfully", async () => {
      const partyRes = await pool.query(
        "SELECT id FROM parties WHERE business_id = $1 LIMIT 1",
        [createdBusinessId],
      );
      const partyId = partyRes.rows[0].id;

      const res = await request(app)
        .put(`/v1/businesses/${createdBusinessId}/parties/${partyId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Updated Test Party",
          shipping_address: ["789 New Lane"],
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Updated Test Party");
      expect(res.body.shipping_address).toEqual(["789 New Lane"]);
    });
  });
});
