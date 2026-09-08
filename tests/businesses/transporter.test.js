import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../src/app.js";
import pool from "../../src/db/db.js";
import { ensureSchema } from "../../src/db/ensureSchema.js";

/**
 * Freight on a purchase is owed to the transporter, not to the supplier.
 * These cover the split, and - just as importantly - that a purchase with no
 * transporter still behaves exactly as it did before the leg existed.
 */
describe("Transporter leg on purchases", () => {
  let token;
  let testUserId;
  let businessId;
  let supplierId;
  let transporterId;
  let transporterId2;
  let itemId;

  const auth = (req) => req.set("Authorization", `Bearer ${token}`);
  const balanceOf = async (id) => {
    const res = await pool.query("SELECT current_balance FROM parties WHERE id = $1", [id]);
    return Number(res.rows[0].current_balance);
  };
  const invoiceRow = async (id) => {
    const res = await pool.query("SELECT * FROM invoices WHERE id = $1", [id]);
    return res.rows[0];
  };

  // 1000 units @ 10 = 10000 goods; 1000 @ 0.55 = 550 freight; 10550 grand total.
  const purchaseBody = (overrides = {}) => ({
    party_id: supplierId,
    invoice_type: "purchase",
    payment_mode: "credit",
    paid_amount: 0,
    transporter_party_id: transporterId,
    vehicle_no: "GJ01 XX 0000",
    transport_qty: 1000,
    transport_rate: 0.55,
    items: [{ item_id: itemId, name: "Brick", quantity: 1000, unit_price: 10 }],
    ...overrides,
  });

  const createPurchase = (overrides) =>
    auth(request(app).post(`/v1/businesses/${businessId}/invoices`)).send(
      purchaseBody(overrides)
    );

  beforeAll(async () => {
    await ensureSchema();
    const email = `trans_user_${Math.random().toString(36).substring(2, 11)}@example.com`;
    const signupRes = await request(app).post("/v1/auth/signup").send({
      name: "Transport Owner",
      email,
      password: "password123",
      confirmPassword: "password123",
    });
    token = signupRes.body.accessToken;
    testUserId = signupRes.body.user.id;

    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const randLetters = Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * 26)]).join("");
    const bizRes = await pool.query(
      `INSERT INTO businesses (id, user_id, name, address, city, state, pincode, gstin, business_type, invoice_prefix, financial_year)
       VALUES (gen_random_uuid(), $1, 'Transport Test Biz', 'Addr', 'City', 'State', '123', $2, 'retailer', 'TRN', '2026')
       RETURNING id`,
      [testUserId, `24${randLetters}1234A1Z1`]
    );
    businessId = bizRes.rows[0].id;

    const mkParty = async (name, type) => {
      const res = await pool.query(
        `INSERT INTO parties (business_id, name, party_type, opening_balance, current_balance)
         VALUES ($1, $2, $3, 0, 0) RETURNING id`,
        [businessId, name, type]
      );
      return res.rows[0].id;
    };
    supplierId = await mkParty("Brick Supplier", "supplier");
    transporterId = await mkParty("Shree Transport", "transporter");
    transporterId2 = await mkParty("Second Transport", "transporter");

    const itemRes = await pool.query(
      `INSERT INTO items (business_id, name) VALUES ($1, 'Brick') RETURNING id`,
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

  it("charges the goods to the supplier and the freight to the transporter", async () => {
    const before = { s: await balanceOf(supplierId), t: await balanceOf(transporterId) };
    const res = await createPurchase();

    expect(res.statusCode).toBe(201);
    expect(Number(res.body.total_amount)).toBe(10550);
    expect(Number(res.body.transport_cost)).toBe(550);
    expect(Number(res.body.transport_rate)).toBe(0.55);
    expect(res.body.vehicle_no).toBe("GJ01 XX 0000");
    expect(res.body.transporter_party_id).toBe(transporterId);

    // Supplier owes the goods only; the freight sits on the transporter.
    expect(await balanceOf(supplierId)).toBe(before.s - 10000);
    expect(await balanceOf(transporterId)).toBe(before.t - 550);

    await auth(request(app).delete(`/v1/businesses/${businessId}/invoices/${res.body.id}`));
  });

  it("splits paid amounts per leg and reports a whole-bill status", async () => {
    const before = { s: await balanceOf(supplierId), t: await balanceOf(transporterId) };
    const res = await createPurchase({ paid_amount: 4000, transport_paid_amount: 550 });

    expect(res.statusCode).toBe(201);
    expect(Number(res.body.paid_amount)).toBe(4000);
    expect(Number(res.body.transport_paid_amount)).toBe(550);
    // 4550 of 10550 -> partially paid, even though the transport leg is settled.
    expect(res.body.payment_status).toBe("partially_paid");

    expect(await balanceOf(supplierId)).toBe(before.s - 6000);
    expect(await balanceOf(transporterId)).toBe(before.t);

    await auth(request(app).delete(`/v1/businesses/${businessId}/invoices/${res.body.id}`));
  });

  it("caps each leg against its own obligation", async () => {
    const overGoods = await createPurchase({ paid_amount: 10550 });
    expect(overGoods.statusCode).toBe(400);

    const overTransport = await createPurchase({ transport_paid_amount: 600 });
    expect(overTransport.statusCode).toBe(400);
  });

  it("rejects a transporter that is also the supplier, or one on a sale", async () => {
    const same = await createPurchase({ transporter_party_id: supplierId });
    expect(same.statusCode).toBe(400);

    const onSale = await createPurchase({
      invoice_type: "sale",
      invoice_number: `SALE-${Date.now()}`,
    });
    expect(onSale.statusCode).toBe(400);
  });

  describe("editing", () => {
    it("moves the freight when the transporter is swapped", async () => {
      const created = await createPurchase();
      const before = { t1: await balanceOf(transporterId), t2: await balanceOf(transporterId2) };

      const res = await auth(
        request(app).put(`/v1/businesses/${businessId}/invoices/${created.body.id}`)
      ).send(purchaseBody({ transporter_party_id: transporterId2 }));

      expect(res.statusCode).toBe(200);
      expect(await balanceOf(transporterId)).toBe(before.t1 + 550);
      expect(await balanceOf(transporterId2)).toBe(before.t2 - 550);

      await auth(request(app).delete(`/v1/businesses/${businessId}/invoices/${created.body.id}`));
    });

    it("hands the freight back to the supplier when the transporter is removed", async () => {
      const created = await createPurchase();
      const before = { s: await balanceOf(supplierId), t: await balanceOf(transporterId) };

      const res = await auth(
        request(app).put(`/v1/businesses/${businessId}/invoices/${created.body.id}`)
      ).send(purchaseBody({ transporter_party_id: null }));

      expect(res.statusCode).toBe(200);
      // Without a transporter the freight is the supplier's again - the rule
      // every pre-existing row still runs under.
      expect(await balanceOf(supplierId)).toBe(before.s - 550);
      expect(await balanceOf(transporterId)).toBe(before.t + 550);

      await auth(request(app).delete(`/v1/businesses/${businessId}/invoices/${created.body.id}`));
    });

    it("leaves a legacy purchase untouched when it is saved unchanged", async () => {
      // Written the way rows looked before transporters existed: freight folded
      // into the total, charged to the supplier, no transporter_party_id.
      const legacy = await pool.query(
        `INSERT INTO invoices (business_id, party_id, invoice_number, invoice_type,
           transport_cost, sub_total, tax_amount, discount_amount, total_amount,
           paid_amount, payment_status, payment_mode)
         VALUES ($1, $2, $3, 'purchase', 550, 10000, 0, 0, 10550, 0, 'unpaid', 'credit')
         RETURNING id`,
        [businessId, supplierId, `LEGACY-${Date.now()}`]
      );
      const legacyId = legacy.rows[0].id;
      await pool.query(
        "UPDATE parties SET current_balance = current_balance - 10550 WHERE id = $1",
        [supplierId]
      );
      const before = await balanceOf(supplierId);

      const row = await invoiceRow(legacyId);
      const res = await auth(
        request(app).put(`/v1/businesses/${businessId}/invoices/${legacyId}`)
      ).send({
        party_id: supplierId,
        invoice_number: row.invoice_number,
        invoice_type: "purchase",
        payment_mode: "credit",
        paid_amount: 0,
        transport_cost: 550,
        items: [{ item_id: itemId, name: "Brick", quantity: 1000, unit_price: 10 }],
      });

      expect(res.statusCode).toBe(200);
      expect(Number(res.body.total_amount)).toBe(10550);
      expect(await balanceOf(supplierId)).toBe(before);

      await auth(request(app).delete(`/v1/businesses/${businessId}/invoices/${legacyId}`));
    });
  });

  it("returns both balances to baseline on delete", async () => {
    const before = { s: await balanceOf(supplierId), t: await balanceOf(transporterId) };
    const created = await createPurchase();

    const res = await auth(
      request(app).delete(`/v1/businesses/${businessId}/invoices/${created.body.id}`)
    );

    expect(res.statusCode).toBe(204);
    expect(await balanceOf(supplierId)).toBe(before.s);
    expect(await balanceOf(transporterId)).toBe(before.t);
  });

  describe("linked payments", () => {
    it("settles the transport leg without touching the supplier's", async () => {
      const created = await createPurchase();
      const beforeSupplier = await balanceOf(supplierId);

      const pay = await auth(request(app).post(`/v1/businesses/${businessId}/payments`)).send({
        party_id: transporterId,
        invoice_id: created.body.id,
        payment_type: "payment_out",
        amount: 550,
        payment_mode: "cash",
      });

      expect(pay.statusCode).toBe(201);
      const row = await invoiceRow(created.body.id);
      expect(Number(row.transport_paid_amount)).toBe(550);
      expect(Number(row.paid_amount)).toBe(0);
      expect(await balanceOf(supplierId)).toBe(beforeSupplier);

      // And the revert puts it back on the same leg.
      await auth(request(app).delete(`/v1/businesses/${businessId}/payments/${pay.body.id}`));
      const reverted = await invoiceRow(created.body.id);
      expect(Number(reverted.transport_paid_amount)).toBe(0);
      expect(Number(reverted.paid_amount)).toBe(0);

      await auth(request(app).delete(`/v1/businesses/${businessId}/invoices/${created.body.id}`));
    });

    it("caps a transporter's payment at the freight, not the whole bill", async () => {
      const created = await createPurchase();

      const pay = await auth(request(app).post(`/v1/businesses/${businessId}/payments`)).send({
        party_id: transporterId,
        invoice_id: created.body.id,
        payment_type: "payment_out",
        amount: 600,
        payment_mode: "cash",
      });

      expect(pay.statusCode).toBe(400);

      await auth(request(app).delete(`/v1/businesses/${businessId}/invoices/${created.body.id}`));
    });
  });

  it("bills the freight on the transporter's own ledger", async () => {
    const created = await createPurchase();

    const res = await auth(
      request(app).get(
        `/v1/businesses/${businessId}/dashboard/reports/party-ledger/${transporterId}`
      )
    );

    expect(res.statusCode).toBe(200);
    const transportRows = res.body.ledger.filter((e) => e.type === "transport");
    expect(transportRows).toHaveLength(1);
    expect(transportRows[0].total_amount).toBe(550);
    expect(transportRows[0].balance_effect).toBe(-550);
    // The running balance has to agree with the stored balance, or the ledger
    // and the party list tell the user two different things.
    const last = res.body.ledger[res.body.ledger.length - 1];
    expect(last.running_balance).toBe(await balanceOf(transporterId));

    await auth(request(app).delete(`/v1/businesses/${businessId}/invoices/${created.body.id}`));
  });

  it("refuses to delete a party still named as a transporter", async () => {
    const created = await createPurchase();

    const res = await auth(
      request(app).delete(`/v1/businesses/${businessId}/parties/${transporterId}`)
    );
    expect(res.statusCode).toBe(400);

    await auth(request(app).delete(`/v1/businesses/${businessId}/invoices/${created.body.id}`));
  });
});
