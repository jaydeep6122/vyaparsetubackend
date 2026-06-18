import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../src/app.js";
import pool from "../../src/db/db.js";
import { ensureSchema } from "../../src/db/ensureSchema.js";

describe("Brick Kiln Factories Integration Tests", () => {
  let token;
  let testUserEmail;
  let testUserId;
  let factoryId;
  
  let moulderId;
  let stackerId;
  let loaderId;

  let doubleDutyLogId;
  let directProductionLogId;
  let internalTransferLogId;
  let outwardLogId;

  let peshgiTxId;
  let khorakiTxId;

  beforeAll(async () => {
    await ensureSchema();
    testUserEmail = `kiln_user_${Math.random().toString(36).substring(2, 11)}@example.com`;
    
    // Register user
    const signupRes = await request(app)
      .post("/v1/auth/signup")
      .send({
        name: "Kiln Owner",
        email: testUserEmail,
        password: "password123",
        confirmPassword: "password123"
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

  describe("Factories CRUD", () => {
    it("should create a brick factory site", async () => {
      const res = await request(app)
        .post("/v1/factories")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Siddharth Bhatta Unit 1",
          location: "Pune, Maharashtra"
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.name).toBe("Siddharth Bhatta Unit 1");
      factoryId = res.body.id;
    });

    it("should list all factories for the user", async () => {
      const res = await request(app)
        .get("/v1/factories")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(factoryId);
    });

    it("should retrieve a factory with initial 0 stock inventory", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.inventory).toBeDefined();
      expect(res.body.inventory.raw_field_stock).toBe(0);
      expect(res.body.inventory.kiln_stock).toBe(0);
      expect(res.body.inventory.stockyard_stock).toBe(0);
      expect(res.body.inventory.net_sold).toBe(0);
    });
  });

  describe("Workers API", () => {
    it("should register a moulder (Type 1)", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/workers`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Ramesh Pathera",
          phone: "9876543210",
          role: "moulder",
          wage_type: "piece_rate",
          base_rate: 1200
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.name).toBe("Ramesh Pathera");
      moulderId = res.body.id;
    });

    it("should register a stacker (Type 2)", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/workers`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Suresh Bharai",
          phone: "9876543211",
          role: "stacker",
          wage_type: "piece_rate",
          base_rate: 400
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.name).toBe("Suresh Bharai");
      stackerId = res.body.id;
    });

    it("should register a loader (Type 3)", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/workers`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Amit Nikasi",
          phone: "9876543212",
          role: "loader",
          wage_type: "piece_rate",
          base_rate: 300,
          internal_loader_rate: 150
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.name).toBe("Amit Nikasi");
      loaderId = res.body.id;
    });
  });

  describe("Work Logs & Stock Updates", () => {
    it("should log double-duty transfer and update unsettled earnings for moulder and stacker", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/work-logs`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          type1_worker_id: moulderId,
          type2_worker_id: stackerId,
          operation_type: "transfer_to_kiln",
          quantity: 5000
        });

      expect(res.statusCode).toBe(201);
      expect(Number(res.body.earnings_type1)).toBe(6000); // 5 * 1200
      expect(Number(res.body.earnings_type2)).toBe(2000); // 5 * 400
      doubleDutyLogId = res.body.id;

      // Verify running balances on workers
      const moulderCheck = await request(app)
        .get(`/v1/factories/${factoryId}/workers/${moulderId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(Number(moulderCheck.body.unsettled_earnings)).toBe(6000);

      const stackerCheck = await request(app)
        .get(`/v1/factories/${factoryId}/workers/${stackerId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(Number(stackerCheck.body.unsettled_earnings)).toBe(2000);
    });

    it("should log direct production for moulder and increase field stock", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/work-logs`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          type1_worker_id: moulderId,
          operation_type: "production",
          quantity: 3000
        });

      expect(res.statusCode).toBe(201);
      expect(Number(res.body.earnings_type1)).toBe(3600); // 3 * 1200
      directProductionLogId = res.body.id;

      // Verify raw field stock is now 3000 and kiln stock is 5000
      const factoryCheck = await request(app)
        .get(`/v1/factories/${factoryId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(factoryCheck.body.inventory.raw_field_stock).toBe(3000);
      expect(factoryCheck.body.inventory.kiln_stock).toBe(5000);

      // Moulder running balance should be 6000 + 3600 = 9600
      const moulderCheck = await request(app)
        .get(`/v1/factories/${factoryId}/workers/${moulderId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(Number(moulderCheck.body.unsettled_earnings)).toBe(9600);
    });

    it("should log internal kiln unloading by loader, decreasing kiln stock and increasing stockyard stock", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/work-logs`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          type3_worker_id: loaderId,
          operation_type: "load_internal",
          quantity: 4000
        });

      expect(res.statusCode).toBe(201);
      expect(Number(res.body.earnings_type3)).toBe(600); // 4 * 150 (internal rate)
      internalTransferLogId = res.body.id;

      // Kiln stock should drop to 5000 - 4000 = 1000
      // Yard stock should increase to 4000
      const factoryCheck = await request(app)
        .get(`/v1/factories/${factoryId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(factoryCheck.body.inventory.kiln_stock).toBe(1000);
      expect(factoryCheck.body.inventory.stockyard_stock).toBe(4000);
    });

    it("should log outward sales loading by loader, decreasing yard stock and increasing net sold", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/work-logs`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          type3_worker_id: loaderId,
          operation_type: "load_outward",
          quantity: 3000
        });

      expect(res.statusCode).toBe(201);
      expect(Number(res.body.earnings_type3)).toBe(900); // 3 * 300 (base rate)
      outwardLogId = res.body.id;

      // Yard stock should drop to 4000 - 3000 = 1000
      // Net sold should become 3000
      const factoryCheck = await request(app)
        .get(`/v1/factories/${factoryId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(factoryCheck.body.inventory.stockyard_stock).toBe(1000);
      expect(factoryCheck.body.inventory.net_sold).toBe(3000);
    });
  });

  describe("Cash Transactions (Peshgi & Khoraki)", () => {
    it("should record a Peshgi advance for moulder", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/transactions`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          worker_id: moulderId,
          transaction_type: "peshgi",
          amount: 15000,
          payment_mode: "cash",
          description: "Season joining advance"
        });

      expect(res.statusCode).toBe(201);
      peshgiTxId = res.body.id;

      const workerCheck = await request(app)
        .get(`/v1/factories/${factoryId}/workers/${moulderId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(Number(workerCheck.body.advance_balance)).toBe(15000);
    });

    it("should record a Khoraki weekly food allowance for moulder", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/transactions`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          worker_id: moulderId,
          transaction_type: "khoraki",
          amount: 1000,
          payment_mode: "cash"
        });

      expect(res.statusCode).toBe(201);
      khorakiTxId = res.body.id;

      const workerCheck = await request(app)
        .get(`/v1/factories/${factoryId}/workers/${moulderId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(Number(workerCheck.body.unsettled_khoraki)).toBe(1000);
    });
  });

  describe("Manual Settlements (Hisaab)", () => {
    it("should preview weekly settlement details accurately", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}/settlements/preview/${moulderId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(Number(res.body.gross_earnings)).toBe(9600); // 6000 + 3600
      expect(Number(res.body.khoraki_deducted)).toBe(1000);
      expect(Number(res.body.advance_balance)).toBe(15000);
      expect(Number(res.body.suggested_net_payout)).toBe(8600); // 9600 - 1000
    });

    it("should finalize manual settlement and deduct recovered Peshgi", async () => {
      // Start date / end date covers logs
      const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const end = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const res = await request(app)
        .post(`/v1/factories/${factoryId}/settlements`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          worker_id: moulderId,
          start_date: start,
          end_date: end,
          gross_earnings: 9600,
          khoraki_deducted: 1000,
          peshgi_recovered: 2000, // Recover ₹2,000 from outstanding Peshgi
          net_payout: 6600, // 9600 - 1000 - 2000
          payment_mode: "cash",
          notes: "First weekly settlement"
        });

      expect(res.statusCode).toBe(201);
      expect(Number(res.body.net_payout)).toBe(6600);
      expect(Number(res.body.peshgi_recovered)).toBe(2000);

      // Verify worker's updated balances
      const workerCheck = await request(app)
        .get(`/v1/factories/${factoryId}/workers/${moulderId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(Number(workerCheck.body.advance_balance)).toBe(13000); // 15000 - 2000
      expect(Number(workerCheck.body.unsettled_khoraki)).toBe(0);
      expect(Number(workerCheck.body.unsettled_earnings)).toBe(0);
    });

    it("should block deleting settled logs and transactions", async () => {
      const deleteLog = await request(app)
        .delete(`/v1/factories/${factoryId}/work-logs/${doubleDutyLogId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(deleteLog.statusCode).toBe(400); // Settled
    });
  });
});
