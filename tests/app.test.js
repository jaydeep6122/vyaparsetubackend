import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import app from "../src/app.js";

describe("App", () => {
  it("should return 200 for root route", async () => {
    const res = await request(app).get("/");
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Request sent by Cron");
  });

  it("should return 404 for unknown route below /v1", async () => {
    const res = await request(app).get("/v1/unknown");
    expect(res.statusCode).toBe(404);
  });
});
