import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../src/app.js";
import pool from "../src/db/db.js";
import { ensureSchema } from "../src/db/ensureSchema.js";

describe("App", () => {
  beforeAll(async () => {
    await ensureSchema();
  }, 30000);

  afterAll(async () => {
    await pool.end();
  });

  it("should return 200 for root route", async () => {
    const res = await request(app).get("/");
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Request sent by Cron");
  });

  it("should return 404 for unknown route below /v1", async () => {
    const res = await request(app).get("/v1/unknown");
    expect(res.statusCode).toBe(404);
  });

  it("should return 200 and the app version for GET /v1/app-version", async () => {
    const res = await request(app).get("/v1/app-version");
    expect(res.statusCode).toBe(200);
    expect(res.body.version).toBe("1.0.0+3");
  });
});
