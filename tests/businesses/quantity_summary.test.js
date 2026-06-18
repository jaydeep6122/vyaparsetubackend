import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../src/app.js";
import pool from "../../src/db/db.js";
import { ensureSchema } from "../../src/db/ensureSchema.js";

describe("Quantity Summary Integration Tests", () => {
  let token;
  let testUserEmail;
  let testUserId;
  let businessId;
  let partyAId;
  let partyBId;
  let itemId;

  beforeAll(async () => {
    await ensureSchema();
    testUserEmail = `qty_user_${Math.random().toString(36).substring(2, 11)}@example.com`;

    // 1. Register a user
    const signupRes = await request(app)
      .post("/v1/auth/signup")
      .send({
        name: "Qty Tracker Owner",
        email: testUserEmail,
        password: "password123",
        confirmPassword: "password123"
      });
    token = signupRes.body.accessToken;
    testUserId = signupRes.body.user.id;

    // 2. Create a business
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const randLetters = Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * 26)]).join("");
    const gstin = `27${randLetters}5678B1Z1`;
    const bizRes = await pool.query(
      `INSERT INTO businesses (id, user_id, name, address, city, state, pincode, gstin, business_type, invoice_prefix, financial_year)
       VALUES (gen_random_uuid(), $1, 'Qty Test Biz', 'Addr', 'City', 'State', '123', $2, 'retailer', 'INV', '2026')
       RETURNING id`,
      [testUserId, gstin]
    );
    businessId = bizRes.rows[0].id;

    // 3. Create Parties A and B
    const partyARes = await pool.query(
      `INSERT INTO parties (business_id, name, party_type)
       VALUES ($1, 'Party A', 'supplier') RETURNING id`,
      [businessId]
    );
    partyAId = partyARes.rows[0].id;

    const partyBRes = await pool.query(
      `INSERT INTO parties (business_id, name, party_type)
       VALUES ($1, 'Party B', 'customer') RETURNING id`,
      [businessId]
    );
    partyBId = partyBRes.rows[0].id;

    // 4. Create an Item
    const itemRes = await pool.query(
      `INSERT INTO items (business_id, name)
       VALUES ($1, 'iPhone') RETURNING id`,
      [businessId]
    );
    itemId = itemRes.rows[0].id;

    // 5. Create Invoices via standard API endpoints to verify full integration
    // Invoice 1: Purchase 10 iPhones from Party A
    await request(app)
      .post(`/v1/businesses/${businessId}/invoices`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        party_id: partyAId,
        invoice_number: "PUR-QTY-1",
        invoice_type: "purchase",
        payment_mode: "cash",
        items: [
          {
            item_id: itemId,
            name: "iPhone",
            quantity: 10,
            unit_price: 1000
          }
        ]
      });

    // Invoice 2: Sale 5 iPhones to Party B
    await request(app)
      .post(`/v1/businesses/${businessId}/invoices`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        party_id: partyBId,
        invoice_number: "SAL-QTY-1",
        invoice_type: "sale",
        payment_mode: "cash",
        items: [
          {
            item_id: itemId,
            name: "iPhone",
            quantity: 5,
            unit_price: 1200
          }
        ]
      });

    // Invoice 3: Sale 3 iPhones to Party B
    await request(app)
      .post(`/v1/businesses/${businessId}/invoices`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        party_id: partyBId,
        invoice_number: "SAL-QTY-2",
        invoice_type: "sale",
        payment_mode: "cash",
        items: [
          {
            item_id: itemId,
            name: "iPhone",
            quantity: 3,
            unit_price: 1200
          }
        ]
      });

    // Invoice 4: Sale Return 2 iPhones from Party B
    await request(app)
      .post(`/v1/businesses/${businessId}/invoices`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        party_id: partyBId,
        invoice_number: "RET-QTY-1",
        invoice_type: "sale_return",
        payment_mode: "cash",
        items: [
          {
            item_id: itemId,
            name: "iPhone",
            quantity: 2,
            unit_price: 1200
          }
        ]
      });
  });

  afterAll(async () => {
    if (testUserId) {
      await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
    }
    await pool.end();
  });

  describe("GET /v1/businesses/:businessId/items/:itemId/quantity-summary", () => {
    it("should return the overall and per-party quantity calculations correctly", async () => {
      const res = await request(app)
        .get(`/v1/businesses/${businessId}/items/${itemId}/quantity-summary`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.itemId).toBe(itemId);
      
      // Verify overall
      expect(Number(res.body.overall.purchased)).toBe(10);
      expect(Number(res.body.overall.sold)).toBe(8); // 5 + 3
      expect(Number(res.body.overall.sale_returned)).toBe(2);
      expect(Number(res.body.overall.purchase_returned)).toBe(0);

      // Verify byParty breakdown
      const partyAData = res.body.byParty.find(p => p.party_id === partyAId);
      expect(partyAData).toBeDefined();
      expect(partyAData.party_name).toBe("Party A");
      expect(Number(partyAData.purchased)).toBe(10);
      expect(Number(partyAData.sold)).toBe(0);

      const partyBData = res.body.byParty.find(p => p.party_id === partyBId);
      expect(partyBData).toBeDefined();
      expect(partyBData.party_name).toBe("Party B");
      expect(Number(partyBData.purchased)).toBe(0);
      expect(Number(partyBData.sold)).toBe(8);
      expect(Number(partyBData.sale_returned)).toBe(2);
    });

    it("should return 404 for a non-existent item UUID", async () => {
      const nonExistentUuid = "00000000-0000-0000-0000-000000000000";
      const res = await request(app)
        .get(`/v1/businesses/${businessId}/items/${nonExistentUuid}/quantity-summary`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toBe("Item not found");
    });
  });

  describe("GET /v1/businesses/:businessId/parties/:partyId/quantity-summary", () => {
    it("should return the list of item quantities transacted with Party A", async () => {
      const res = await request(app)
        .get(`/v1/businesses/${businessId}/parties/${partyAId}/quantity-summary`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.partyId).toBe(partyAId);
      expect(res.body.items.length).toBe(1);

      const itemData = res.body.items[0];
      expect(itemData.item_id).toBe(itemId);
      expect(itemData.item_name).toBe("iPhone");
      expect(Number(itemData.purchased)).toBe(10);
      expect(Number(itemData.sold)).toBe(0);
    });

    it("should return the list of item quantities transacted with Party B", async () => {
      const res = await request(app)
        .get(`/v1/businesses/${businessId}/parties/${partyBId}/quantity-summary`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.partyId).toBe(partyBId);
      expect(res.body.items.length).toBe(1);

      const itemData = res.body.items[0];
      expect(itemData.item_id).toBe(itemId);
      expect(itemData.item_name).toBe("iPhone");
      expect(Number(itemData.purchased)).toBe(0);
      expect(Number(itemData.sold)).toBe(8);
      expect(Number(itemData.sale_returned)).toBe(2);
    });

    it("should return 404 for a non-existent party UUID", async () => {
      const nonExistentUuid = "00000000-0000-0000-0000-000000000000";
      const res = await request(app)
        .get(`/v1/businesses/${businessId}/parties/${nonExistentUuid}/quantity-summary`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toBe("Party not found");
    });
  });
});
