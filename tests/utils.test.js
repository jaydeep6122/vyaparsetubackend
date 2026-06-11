import { describe, it, expect, jest } from "@jest/globals";
import { ApiError } from "../src/utils/ApiError.js";
import { asyncHandler } from "../src/utils/asyncHandler.js";

describe("Utils", () => {
  describe("ApiError", () => {
    it("should create an ApiError object with statusCode and message", () => {
      const error = new ApiError(400, "Bad Request");
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe("Bad Request");
      expect(error.success).toBe(false);
      expect(error.errors).toEqual([]);
    });

    it("should create an ApiError with custom errors", () => {
      const error = new ApiError(422, "Validation failed", ["field required"]);
      expect(error.statusCode).toBe(422);
      expect(error.errors).toEqual(["field required"]);
    });
  });

  describe("asyncHandler", () => {
    it("should call next with error when handler throws", async () => {
      const error = new Error("Test error");
      const handler = asyncHandler(async () => {
        throw error;
      });

      const next = jest.fn();
      await handler({}, {}, next);
      expect(next).toHaveBeenCalledWith(error);
    });

    it("should not call next when handler resolves", async () => {
      const handler = asyncHandler(async (req, res) => {
        res.json({ success: true });
      });

      const next = jest.fn();
      const res = { json: jest.fn() };
      await handler({}, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });
});
