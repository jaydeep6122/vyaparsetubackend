import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../src/app.js";
import pool from "../../src/db/db.js";
import { ensureSchema } from "../../src/db/ensureSchema.js";

describe("Payments Integration Tests (Linked to Invoices)", () => {
  let token;
  let testUserEmail;
  let testUserId;
  let businessId;
  let partyId;
  let itemId;
  let invoiceId;
  let paymentId1;
  let paymentId2;

  beforeAll(async () => {
    await ensureSchema();
    testUserEmail = `pay_user_${Math.random().toString(36).substring(2, 11)}@example.com`;
    // Register user
    const signupRes = await request(app)
      .post("/v1/auth/signup")
      .send({
        name: "Payment Test Owner",
        email: testUserEmail,
        password: "password123",
        confirmPassword: "password123"
      });
    token = signupRes.body.accessToken;
    testUserId = signupRes.body.user.id;

    // Create a business profile
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const randLetters = Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * 26)]).join("");
    const gstin = `27${randLetters}5678B1Z1`;
    const bizRes = await pool.query(
      `INSERT INTO businesses (id, user_id, name, address, city, state, pincode, gstin, business_type, invoice_prefix, financial_year)
       VALUES (gen_random_uuid(), $1, 'Payment Test Biz', 'Addr', 'City', 'State', '123', $2, 'retailer', 'INV', '2026')
       RETURNING id`,
      [testUserId, gstin]
    );
    businessId = bizRes.rows[0].id;

    // Create a party
    const partyRes = await pool.query(
      `INSERT INTO parties (business_id, name, party_type, opening_balance, current_balance)
       VALUES ($1, 'Payment Party Customer', 'customer', 0, 0) RETURNING id`,
      [businessId]
    );
    partyId = partyRes.rows[0].id;

    // Create an item
    const itemRes = await pool.query(
      `INSERT INTO items (business_id, name)
       VALUES ($1, 'Widget') RETURNING id`,
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

  describe("Linked Payments Workflow", () => {
    it("should create a sale invoice with partial paid_amount (1000/10000 paid)", async () => {
      const res = await request(app)
        .post(`/v1/businesses/${businessId}/invoices`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          party_id: partyId,
          invoice_number: "INV-PAY-001",
          invoice_type: "sale",
          payment_mode: "cash",
          paid_amount: 1000,
          discount_amount: 0,
          items: [
            {
              item_id: itemId,
              name: "Widget",
              quantity: 10,
              unit_price: 1000
            }
          ]
        });

      expect(res.statusCode).toBe(201);
      expect(Number(res.body.total_amount)).toBe(10000);
      expect(Number(res.body.paid_amount)).toBe(1000);
      expect(res.body.payment_status).toBe("partially_paid");
      invoiceId = res.body.id;

      // Party balance should be unpaid portion: 9000 (receivable)
      const partyCheck = await pool.query("SELECT current_balance FROM parties WHERE id = $1", [partyId]);
      expect(Number(partyCheck.rows[0].current_balance)).toBe(9000);
    });

    it("should create a linked payment of 5000 and update invoice payment_status", async () => {
      const res = await request(app)
        .post(`/v1/businesses/${businessId}/payments`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          party_id: partyId,
          invoice_id: invoiceId,
          payment_type: "payment_in",
          amount: 5000,
          payment_mode: "cash",
          description: "First installment"
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.invoice_id).toBe(invoiceId);
      paymentId1 = res.body.id;

      // Verify invoice paid_amount is updated to 6000 and status remains partially_paid
      const invoiceCheck = await pool.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
      expect(Number(invoiceCheck.rows[0].paid_amount)).toBe(6000);
      expect(invoiceCheck.rows[0].payment_status).toBe("partially_paid");

      // Verify party balance is updated: 9000 - 5000 = 4000
      const partyCheck = await pool.query("SELECT current_balance FROM parties WHERE id = $1", [partyId]);
      expect(Number(partyCheck.rows[0].current_balance)).toBe(4000);
    });

    it("should reject a linked payment that exceeds the remaining unpaid amount of 4000", async () => {
      const res = await request(app)
        .post(`/v1/businesses/${businessId}/payments`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          party_id: partyId,
          invoice_id: invoiceId,
          payment_type: "payment_in",
          amount: 5000, // Remaining unpaid is 4000, so 5000 is invalid
          payment_mode: "cash"
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain("exceeds the remaining unpaid invoice amount");
    });

    it("should link another payment of 4000 to fully pay the invoice", async () => {
      const res = await request(app)
        .post(`/v1/businesses/${businessId}/payments`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          party_id: partyId,
          invoice_id: invoiceId,
          payment_type: "payment_in",
          amount: 4000,
          payment_mode: "cash",
          description: "Final payment"
        });

      expect(res.statusCode).toBe(201);
      paymentId2 = res.body.id;

      // Verify invoice paid_amount is 10000 and status is paid
      const invoiceCheck = await pool.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
      expect(Number(invoiceCheck.rows[0].paid_amount)).toBe(10000);
      expect(invoiceCheck.rows[0].payment_status).toBe("paid");

      // Verify party balance is updated: 4000 - 4000 = 0
      const partyCheck = await pool.query("SELECT current_balance FROM parties WHERE id = $1", [partyId]);
      expect(Number(partyCheck.rows[0].current_balance)).toBe(0);
    });

    it("should update a linked payment and revert/reapply invoice paid_amount correctly", async () => {
      // Update the second payment from 4000 to 2000
      const res = await request(app)
        .put(`/v1/businesses/${businessId}/payments/${paymentId2}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          party_id: partyId,
          invoice_id: invoiceId,
          payment_type: "payment_in",
          amount: 2000,
          payment_mode: "cash"
        });

      expect(res.statusCode).toBe(200);

      // Verify invoice paid_amount drops back to 8000 and status reverts to partially_paid
      const invoiceCheck = await pool.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
      expect(Number(invoiceCheck.rows[0].paid_amount)).toBe(8000);
      expect(invoiceCheck.rows[0].payment_status).toBe("partially_paid");

      // Verify party balance becomes 2000
      const partyCheck = await pool.query("SELECT current_balance FROM parties WHERE id = $1", [partyId]);
      expect(Number(partyCheck.rows[0].current_balance)).toBe(2000);
    });

    it("should prevent deleting the invoice because it has linked payments (ON DELETE RESTRICT)", async () => {
      const res = await request(app)
        .delete(`/v1/businesses/${businessId}/invoices/${invoiceId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(500); // Internal server error due to foreign key RESTRICT constraint
    });

    it("should delete a linked payment and revert the invoice paid_amount", async () => {
      const res = await request(app)
        .delete(`/v1/businesses/${businessId}/payments/${paymentId2}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(204);

      // Verify invoice paid_amount is now 6000
      const invoiceCheck = await pool.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
      expect(Number(invoiceCheck.rows[0].paid_amount)).toBe(6000);
      expect(invoiceCheck.rows[0].payment_status).toBe("partially_paid");

      // Verify party balance becomes 4000
      const partyCheck = await pool.query("SELECT current_balance FROM parties WHERE id = $1", [partyId]);
      expect(Number(partyCheck.rows[0].current_balance)).toBe(4000);
    });
  });
});
