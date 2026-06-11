import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../src/app.js";
import pool from "../../src/db/db.js";

describe("Items Integration Tests", () => {
  let token;
  let testUserEmail;
  let testUserId;
  let businessId;
  let createdItemId;

  beforeAll(async () => {
    testUserEmail = `item_user_${Math.random().toString(36).substring(2, 11)}@example.com`;
    // Register user
    const signupRes = await request(app)
      .post("/v1/auth/signup")
      .send({
        name: "Item Owner",
        email: testUserEmail,
        password: "password123",
        confirmPassword: "password123"
      });
    token = signupRes.body.accessToken;
    testUserId = signupRes.body.user.id;

    // Create a business profile
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const randLetters = Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * 26)]).join("");
    const gstin = `27${randLetters}1234A1Z1`;
    await pool.query(
      `INSERT INTO businesses (id, user_id, name, address, city, state, pincode, gstin, business_type, invoice_prefix, financial_year)
       VALUES (gen_random_uuid(), $1, 'Item Test Biz', 'Addr', 'City', 'State', '123', $2, 'retailer', 'ITM', '2026')`,
      [testUserId, gstin]
    );

    const bizRes = await pool.query("SELECT id FROM businesses WHERE user_id = $1", [testUserId]);
    businessId = bizRes.rows[0].id;
  });

  afterAll(async () => {
    if (testUserId) {
      await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
    }
    await pool.end();
  });

  describe("POST /v1/businesses/:businessId/items", () => {
    it("should create a new item successfully", async () => {
      const res = await request(app)
        .post(`/v1/businesses/${businessId}/items`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Test Mouse",
          hsn_code: "8471",
          measuring_unit: "pcs"
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.name).toBe("Test Mouse");
      expect(res.body.hsn_code).toBe("8471");
      expect(res.body.measuring_unit).toBe("pcs");
      createdItemId = res.body.id;
    });
  });

  describe("GET /v1/businesses/:businessId/items", () => {
    it("should list all items for the business", async () => {
      const res = await request(app)
        .get(`/v1/businesses/${businessId}/items`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe("GET /v1/businesses/:businessId/items/:itemId", () => {
    it("should retrieve item by ID", async () => {
      const res = await request(app)
        .get(`/v1/businesses/${businessId}/items/${createdItemId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Test Mouse");
    });
  });

  describe("PUT /v1/businesses/:businessId/items/:itemId", () => {
    it("should update item details successfully", async () => {
      const res = await request(app)
        .put(`/v1/businesses/${businessId}/items/${createdItemId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Updated Mouse",
          hsn_code: "9999"
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Updated Mouse");
      expect(res.body.hsn_code).toBe("9999");
    });
  });

  describe("DELETE /v1/businesses/:businessId/items/:itemId", () => {
    it("should delete the item successfully", async () => {
      // Create a temporary item
      const tempRes = await pool.query(
        `INSERT INTO items (business_id, name)
         VALUES ($1, 'Temp Item') RETURNING id`,
        [businessId]
      );
      const tempId = tempRes.rows[0].id;

      const deleteRes = await request(app)
        .delete(`/v1/businesses/${businessId}/items/${tempId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(deleteRes.statusCode).toBe(204);

      // Verify it is gone
      const verifyRes = await request(app)
        .get(`/v1/businesses/${businessId}/items/${tempId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(verifyRes.statusCode).toBe(404);
    });
  });
});
