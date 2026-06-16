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
    it("should create a sale invoice with chalan_no and adjust party balance", async () => {
      // Total amount: 1 * 50000 = 50000
      // Tax: 18% of 50000 = 9000
      // Transport cost: 2500
      // Total total_amount = 50000 + 9000 + 2500 = 61500
      // Paid: 9000 -> Unpaid/Due: 52500
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
          chalan_no: "CH-12345",
          transport_cost: 2500,
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
      expect(res.body.chalan_no).toBe("CH-12345");
      expect(Number(res.body.transport_cost)).toBe(2500);
      expect(Number(res.body.total_amount)).toBe(61500);
      createdInvoiceId = res.body.id;

      // Verify party balance is updated: current_balance should be 52500 (receivable)
      const partyCheck = await pool.query("SELECT current_balance FROM parties WHERE id = $1", [partyId]);
      expect(Number(partyCheck.rows[0].current_balance)).toBe(52500);
    });

    it("should create a sale invoice without paid_amount successfully (paid_amount should default to 0)", async () => {
      const partyRes = await pool.query(
        `INSERT INTO parties (business_id, name, party_type, opening_balance, current_balance)
         VALUES ($1, 'Optional Party Customer', 'customer', 0, 0) RETURNING id`,
        [businessId]
      );
      const optionalPartyId = partyRes.rows[0].id;

      const res = await request(app)
        .post(`/v1/businesses/${businessId}/invoices`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          party_id: optionalPartyId,
          invoice_number: "INV-2026-OPTIONAL",
          invoice_type: "sale",
          payment_mode: "cash",
          items: [
            {
              item_id: itemId,
              name: "Laptop",
              quantity: 1,
              unit_price: 1000
            }
          ]
        });

      expect(res.statusCode).toBe(201);
      expect(Number(res.body.paid_amount)).toBe(0);
    });

    it("should create a purchase invoice without invoice_number successfully and auto-generate one starting with PUR-", async () => {
      const res = await request(app)
        .post(`/v1/businesses/${businessId}/invoices`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          party_id: partyId,
          invoice_type: "purchase",
          payment_mode: "cash",
          items: [
            {
              item_id: itemId,
              name: "Laptop",
              quantity: 2,
              unit_price: 30000
            }
          ]
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.invoice_number).toMatch(/^PUR-/);

      // Clean up the temporary purchase invoice
      await request(app)
        .delete(`/v1/businesses/${businessId}/invoices/${res.body.id}`)
        .set("Authorization", `Bearer ${token}`);
    });

    it("should fail to create a sale invoice without invoice_number", async () => {
      const res = await request(app)
        .post(`/v1/businesses/${businessId}/invoices`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          party_id: partyId,
          invoice_type: "sale",
          payment_mode: "cash",
          items: [
            {
              item_id: itemId,
              name: "Laptop",
              quantity: 1,
              unit_price: 1000
            }
          ]
        });

      expect(res.statusCode).toBe(400);
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
    it("should update invoice notes and chalan_no successfully", async () => {
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
          chalan_no: "CH-67890",
          transport_cost: 1500,
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
      expect(res.body.chalan_no).toBe("CH-67890");
      expect(Number(res.body.transport_cost)).toBe(1500);

      // Verify party balance is updated: unpaid is 60500 - 9000 = 51500
      const partyCheck = await pool.query("SELECT current_balance FROM parties WHERE id = $1", [partyId]);
      expect(Number(partyCheck.rows[0].current_balance)).toBe(51500);
    });

    it("should update a purchase invoice omitting invoice_number and reuse the existing invoice_number", async () => {
      // 1. Create a purchase invoice with custom invoice number
      const createRes = await request(app)
        .post(`/v1/businesses/${businessId}/invoices`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          party_id: partyId,
          invoice_number: "PUR-TEST-12345",
          invoice_type: "purchase",
          payment_mode: "cash",
          items: [
            {
              item_id: itemId,
              name: "Laptop",
              quantity: 1,
              unit_price: 500
            }
          ]
        });
      expect(createRes.statusCode).toBe(201);
      const purchaseId = createRes.body.id;

      // 2. Update it, omitting invoice_number in req.body
      const updateRes = await request(app)
        .put(`/v1/businesses/${businessId}/invoices/${purchaseId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          party_id: partyId,
          invoice_type: "purchase",
          payment_mode: "cash",
          notes: "updated notes",
          items: [
            {
              item_id: itemId,
              name: "Laptop",
              quantity: 1,
              unit_price: 500
            }
          ]
        });

      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.body.invoice_number).toBe("PUR-TEST-12345");
      expect(updateRes.body.notes).toBe("updated notes");

      // Clean up the temporary purchase invoice
      await request(app)
        .delete(`/v1/businesses/${businessId}/invoices/${purchaseId}`)
        .set("Authorization", `Bearer ${token}`);
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
