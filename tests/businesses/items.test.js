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
          item_type: "product",
          sku: "MSE-001",
          hsn_code: "8471",
          sales_price: 600,
          purchase_price: 350,
          tax_rate: 18,
          is_tax_inclusive: false,
          measuring_unit: "pcs",
          opening_stock: 10,
          low_stock_warning: 2
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.name).toBe("Test Mouse");
      expect(Number(res.body.current_stock)).toBe(10);
      createdItemId = res.body.id;
    });

    it("should fail validation if item_type is invalid", async () => {
      const res = await request(app)
        .post(`/v1/businesses/${businessId}/items`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Invalid Item",
          item_type: "wrong_type"
        });

      expect(res.statusCode).toBe(400);
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
          sales_price: 650
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Updated Mouse");
      expect(Number(res.body.sales_price)).toBe(650);
    });
  });

  describe("POST /v1/businesses/:businessId/items/:itemId/adjust-stock", () => {
    it("should add manual stock adjustments correctly", async () => {
      const res = await request(app)
        .post(`/v1/businesses/${businessId}/items/${createdItemId}/adjust-stock`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          item_id: createdItemId,
          quantity: 5,
          type: "adjustment_add",
          notes: "Manual adjustment add"
        });

      expect(res.statusCode).toBe(200);
      expect(Number(res.body.current_stock)).toBe(15);

      // Verify the transaction was saved
      const txRes = await pool.query(
        "SELECT * FROM stock_transactions WHERE item_id = $1 AND transaction_type = 'adjustment_add'",
        [createdItemId]
      );
      expect(txRes.rowCount).toBeGreaterThan(0);
      const manualTx = txRes.rows.find(t => t.notes === "Manual adjustment add");
      expect(manualTx).toBeDefined();
      expect(Number(manualTx.quantity)).toBe(5);
    });
  });

  describe("DELETE /v1/businesses/:businessId/items/:itemId", () => {
    it("should delete the item successfully", async () => {
      // Create a temporary item
      const tempRes = await pool.query(
        `INSERT INTO items (business_id, name, item_type)
         VALUES ($1, 'Temp Item', 'product') RETURNING id`,
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
