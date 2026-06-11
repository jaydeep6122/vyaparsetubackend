import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../src/app.js";
import pool from "../../src/db/db.js";

describe("Invoices Integration Tests", () => {
  let token;
  let testUserEmail;
  let testUserId;
  let businessId;
  let partyId;
  let itemId;
  let createdInvoiceId;

  beforeAll(async () => {
    testUserEmail = `inv_user_${Math.random().toString(36).substring(2, 11)}@example.com`;
    // Register user
    const signupRes = await request(app)
      .post("/v1/auth/signup")
      .send({
        name: "Invoice Owner",
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
    const bizRes = await pool.query(
      `INSERT INTO businesses (id, user_id, name, address, city, state, pincode, gstin, business_type, invoice_prefix, financial_year)
       VALUES (gen_random_uuid(), $1, 'Invoice Test Biz', 'Addr', 'City', 'State', '123', $2, 'retailer', 'INV', '2026')
       RETURNING id`,
      [testUserId, gstin]
    );
    businessId = bizRes.rows[0].id;

    // Create a party (customer)
    const partyRes = await pool.query(
      `INSERT INTO parties (business_id, name, party_type, opening_balance, current_balance)
       VALUES ($1, 'Invoice Customer', 'customer', 0, 0) RETURNING id`,
      [businessId]
    );
    partyId = partyRes.rows[0].id;

    // Create an item
    const itemRes = await pool.query(
      `INSERT INTO items (business_id, name)
       VALUES ($1, 'Laptop') RETURNING id`,
      [businessId]
    );
    itemId = itemRes.rows[0].id;
  });

  afterAll(async () => {
    if (testUserId) {
      await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
    }
    await pool.end();
  });

  describe("POST /v1/businesses/:businessId/invoices", () => {
    it("should create a sale invoice and adjust party balance", async () => {
      // Total amount: 1 * 50000 = 50000
      // Tax: 18% of 50000 = 9000 -> Total total_amount = 59000
      // Paid: 9000 -> Unpaid/Due: 50000
      const res = await request(app)
        .post(`/v1/businesses/${businessId}/invoices`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          party_id: partyId,
          invoice_number: "INV-2026-001",
          invoice_type: "sale",
          payment_mode: "cash",
          paid_amount: 9000,
          discount_amount: 0,
          items: [
            {
              item_id: itemId,
              name: "Laptop",
              quantity: 1,
              unit_price: 50000,
              tax_rate: 18
            }
          ]
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.invoice_number).toBe("INV-2026-001");
      expect(Number(res.body.total_amount)).toBe(59000);
      createdInvoiceId = res.body.id;

      // Verify party balance is updated: current_balance should be 50000 (receivable)
      const partyCheck = await pool.query("SELECT current_balance FROM parties WHERE id = $1", [partyId]);
      expect(Number(partyCheck.rows[0].current_balance)).toBe(50000);
    });
  });

  describe("GET /v1/businesses/:businessId/invoices", () => {
    it("should list all invoices for the business", async () => {
      const res = await request(app)
        .get(`/v1/businesses/${businessId}/invoices`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe("GET /v1/businesses/:businessId/invoices/:invoiceId", () => {
    it("should retrieve invoice details including items list", async () => {
      const res = await request(app)
        .get(`/v1/businesses/${businessId}/invoices/${createdInvoiceId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.invoice_number).toBe("INV-2026-001");
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBe(1);
      expect(res.body.items[0].name).toBe("Laptop");
    });
  });

  describe("PUT /v1/businesses/:businessId/invoices/:invoiceId", () => {
    it("should update invoice notes successfully", async () => {
      const res = await request(app)
        .put(`/v1/businesses/${businessId}/invoices/${createdInvoiceId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          party_id: partyId,
          invoice_number: "INV-2026-001",
          invoice_type: "sale",
          payment_mode: "cash",
          paid_amount: 9000,
          discount_amount: 0,
          notes: "Updated delivery terms",
          items: [
            {
              item_id: itemId,
              name: "Laptop",
              quantity: 1,
              unit_price: 50000,
              tax_rate: 18
            }
          ]
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.notes).toBe("Updated delivery terms");
    });
  });

  describe("DELETE /v1/businesses/:businessId/invoices/:invoiceId", () => {
    it("should delete invoice and revert party balance", async () => {
      const res = await request(app)
        .delete(`/v1/businesses/${businessId}/invoices/${createdInvoiceId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(204);

      // Verify party balance is reverted: 50000 - 50000 = 0
      const partyCheck = await pool.query("SELECT current_balance FROM parties WHERE id = $1", [partyId]);
      expect(Number(partyCheck.rows[0].current_balance)).toBe(0);

      // Verify invoice is deleted
      const verifyRes = await request(app)
        .get(`/v1/businesses/${businessId}/invoices/${createdInvoiceId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(verifyRes.statusCode).toBe(404);
    });
  });
});
