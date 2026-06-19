import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../src/app.js";
import pool from "../../src/db/db.js";
import { ensureSchema } from "../../src/db/ensureSchema.js";

describe("Brick Factory Wage System Integration Tests", () => {
  let token;
  let testUserEmail;
  let testUserId;
  let factoryId;
  let producerMolderId;
  let kilnWorkerId;
  let truckWorker1Id;
  let truckWorker2Id;

  beforeAll(async () => {
    await ensureSchema();
    testUserEmail = `factory_user_${Math.random().toString(36).substring(2, 11)}@example.com`;
    const signupRes = await request(app).post("/v1/auth/signup").send({
      name: "Factory Owner",
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

  describe("Factory CRUD", () => {
    it("POST /v1/factories - should create a factory", async () => {
      const res = await request(app)
        .post("/v1/factories")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Test Brick Factory",
          location: "Industrial Area, City",
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.name).toBe("Test Brick Factory");
      expect(res.body.location).toBe("Industrial Area, City");
      expect(res.body.user_id).toBe(testUserId);
      factoryId = res.body.id;
    });

    it("POST /v1/factories - should fail without auth", async () => {
      const res = await request(app)
        .post("/v1/factories")
        .send({ name: "No Auth Factory" });

      expect(res.statusCode).toBe(401);
    });

    it("POST /v1/factories - should fail with empty name", async () => {
      const res = await request(app)
        .post("/v1/factories")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "" });

      expect(res.statusCode).toBe(400);
    });

    it("GET /v1/factories - should list factories", async () => {
      const res = await request(app)
        .get("/v1/factories")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].name).toBe("Test Brick Factory");
    });

    it("GET /v1/factories/:factoryId - should get factory details", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Test Brick Factory");
      expect(Number(res.body.worker_count)).toBe(0);
    });

    it("GET /v1/factories/:factoryId - should fail for wrong user", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}`)
        .set("Authorization", `Bearer invalidtoken`);

      expect(res.statusCode).toBe(401);
    });

    it("PUT /v1/factories/:factoryId - should update factory", async () => {
      const res = await request(app)
        .put(`/v1/factories/${factoryId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Updated Brick Factory", location: "New Location" });

      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Updated Brick Factory");
      expect(res.body.location).toBe("New Location");
    });

    it("PUT /v1/factories/:factoryId - should fail for non-existent factory", async () => {
      const res = await request(app)
        .put("/v1/factories/00000000-0000-0000-0000-000000000000")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Ghost Factory" });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("Worker CRUD", () => {
    it("POST /v1/factories/:factoryId/workers - should create producer molder", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/workers`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Rajesh Molder", type: "producer_molder", rate_per_1000: 500 });

      expect(res.statusCode).toBe(201);
      expect(res.body.name).toBe("Rajesh Molder");
      expect(res.body.type).toBe("producer_molder");
      expect(Number(res.body.rate_per_1000)).toBe(500);
      producerMolderId = res.body.id;
    });

    it("POST /v1/factories/:factoryId/workers - should create kiln worker", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/workers`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Suresh Kiln", type: "kiln_worker", rate_per_1000: 300 });

      expect(res.statusCode).toBe(201);
      expect(res.body.type).toBe("kiln_worker");
      kilnWorkerId = res.body.id;
    });

    it("POST /v1/factories/:factoryId/workers - should create truck workers", async () => {
      let res = await request(app)
        .post(`/v1/factories/${factoryId}/workers`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Amit Truck", type: "truck_worker", rate_per_1000: 200 });

      expect(res.statusCode).toBe(201);
      truckWorker1Id = res.body.id;

      res = await request(app)
        .post(`/v1/factories/${factoryId}/workers`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Vijay Truck", type: "truck_worker", rate_per_1000: 200 });

      expect(res.statusCode).toBe(201);
      truckWorker2Id = res.body.id;
    });

    it("POST /v1/factories/:factoryId/workers - should fail with invalid type", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/workers`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Invalid Worker", type: "invalid", rate_per_1000: 100 });

      expect(res.statusCode).toBe(400);
    });

    it("GET /v1/factories/:factoryId/workers - should list workers", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}/workers`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(4);
      expect(res.body[0]).toHaveProperty("balance_due");
    });

    it("GET /v1/factories/:factoryId/workers - should filter by type", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}/workers?type=kiln_worker`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].type).toBe("kiln_worker");
    });

    it("GET /v1/factories/:factoryId/workers/:workerId - should get worker details", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}/workers/${producerMolderId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Rajesh Molder");
      expect(res.body).toHaveProperty("balance_due");
    });

    it("PUT /v1/factories/:factoryId/workers/:workerId - should update worker", async () => {
      const res = await request(app)
        .put(`/v1/factories/${factoryId}/workers/${producerMolderId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Rajesh Molder Updated", rate_per_1000: 550 });

      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe("Rajesh Molder Updated");
      expect(Number(res.body.rate_per_1000)).toBe(550);
    });

    it("DELETE /v1/factories/:factoryId/workers/:workerId - should delete worker", async () => {
      const createRes = await request(app)
        .post(`/v1/factories/${factoryId}/workers`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Temp Worker", type: "truck_worker", rate_per_1000: 150 });

      const tempWorkerId = createRes.body.id;

      const delRes = await request(app)
        .delete(`/v1/factories/${factoryId}/workers/${tempWorkerId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(delRes.statusCode).toBe(204);
    });

    it("DELETE /v1/factories/:factoryId/workers/:workerId - should fail for non-existent worker", async () => {
      const res = await request(app)
        .delete(`/v1/factories/${factoryId}/workers/00000000-0000-0000-0000-000000000000`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(404);
    });
  });

  describe("Transaction Types", () => {
    let today;

    beforeAll(() => {
      today = new Date().toISOString().split("T")[0];
    });

    it("POST handoff - should create handoff transaction", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/transactions/handoff`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          kiln_worker_id: kilnWorkerId,
          producer_molder_id: producerMolderId,
          quantity: 5000,
          date: today,
          notes: "Batch 1 handoff",
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.transaction.type).toBe("handoff");
      expect(res.body.transaction.quantity).toBe(5000);
      expect(res.body.updates.kiln_worker.total_bricks).toBe(5000);
      expect(res.body.updates.producer_molder.total_bricks).toBe(5000);

      expect(Number(res.body.updates.kiln_worker.total_amount)).toBe(1500);
      expect(Number(res.body.updates.producer_molder.total_amount)).toBe(2750);
    });

    it("POST direct - should create direct entry transaction", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/transactions/direct`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          worker_id: producerMolderId,
          quantity: 2000,
          date: today,
          notes: "Direct entry",
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.transaction.type).toBe("direct");
      expect(res.body.transaction.quantity).toBe(2000);
      expect(Number(res.body.updates.total_amount)).toBe(3850);
      expect(Number(res.body.updates.total_bricks)).toBe(7000);
    });

    it("POST truck-distribution - should create truck distribution", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/transactions/truck-distribution`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          truck_worker_ids: [truckWorker1Id, truckWorker2Id],
          total_quantity: 3000,
          date: today,
          notes: "Truck distribution",
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.transaction.type).toBe("truck_dist");
      expect(res.body.per_worker_quantity).toBe(1500);
      expect(res.body.updates.length).toBe(2);
      // each gets 1500 * (200/1000) = 300
      expect(Number(res.body.updates[0].total_amount)).toBe(300);
      expect(Number(res.body.updates[1].total_amount)).toBe(300);
    });

    it("POST truck-distribution - should fail with non-existent worker", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/transactions/truck-distribution`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          truck_worker_ids: ["00000000-0000-0000-0000-000000000000"],
          total_quantity: 1000,
          date: today,
        });

      expect(res.statusCode).toBe(404);
    });

    it("POST money-given - should create money given transaction", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/transactions/money-given`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          worker_id: producerMolderId,
          amount: 2000,
          date: today,
          notes: "Weekly advance",
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.transaction.type).toBe("money_given");
      expect(Number(res.body.transaction.amount)).toBe(2000);
      expect(Number(res.body.updates.total_money_given)).toBe(2000);
      expect(Number(res.body.updates.balance_due)).toBe(1850);
    });

    it("POST handoff - should fail with non-existent kiln worker", async () => {
      const res = await request(app)
        .post(`/v1/factories/${factoryId}/transactions/handoff`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          kiln_worker_id: "00000000-0000-0000-0000-000000000000",
          producer_molder_id: producerMolderId,
          quantity: 1000,
          date: today,
        });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("Transaction Views", () => {
    it("GET /v1/factories/:factoryId/transactions - should list all transactions", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}/transactions`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(4);
    });

    it("GET /v1/factories/:factoryId/transactions - should filter by type", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}/transactions?type=handoff`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].type).toBe("handoff");
    });

    it("GET /v1/factories/:factoryId/transactions/:transactionId - should get single transaction", async () => {
      const listRes = await request(app)
        .get(`/v1/factories/${factoryId}/transactions`)
        .set("Authorization", `Bearer ${token}`);

      const txId = listRes.body[0].id;

      const res = await request(app)
        .get(`/v1/factories/${factoryId}/transactions/${txId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe(txId);
    });

    it("GET /v1/factories/:factoryId/workers/:workerId/transactions - should list worker transactions", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}/workers/${producerMolderId}/transactions`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // producer should have handoff + direct + money_given = 3 transactions
      expect(res.body.length).toBe(3);
    });

    it("GET /v1/factories/:factoryId/transactions - should filter by date range", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}/transactions?date_from=2020-01-01&date_to=2020-12-31`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(0);
    });
  });

  describe("Reports", () => {
    it("GET /v1/factories/:factoryId/workers/:workerId/summary - should return worker summary", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}/workers/${producerMolderId}/summary`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.worker_id).toBe(producerMolderId);
      expect(res.body.name).toBe("Rajesh Molder Updated");
      // wages: handoff(5000) + direct(2000) = 7000 bricks
      expect(Number(res.body.wages.total_bricks)).toBe(7000);
      expect(res.body.money.transactions.length).toBe(1);
      expect(Number(res.body.money.total_given)).toBe(2000);
      expect(Number(res.body.balance_due)).toBe(1850);
    });

    it("GET /v1/factories/:factoryId/summary - should return factory summary", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}/summary`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      // bricks: handoff(5000 each for 2 workers) + direct(2000) + truck(3000) = 15000
      expect(Number(res.body.total_bricks_produced)).toBe(10000);
      expect(res.body.workers_summary.length).toBe(4);
    });

    it("GET /v1/factories/:factoryId/summary - should filter by date range", async () => {
      const res = await request(app)
        .get(`/v1/factories/${factoryId}/summary?from_date=2020-01-01&to_date=2020-12-31`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(Number(res.body.total_bricks_produced)).toBe(0);
      expect(Number(res.body.total_amount_owed)).toBe(0);
    });
  });
});
