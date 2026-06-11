import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError.js";

export function validate(schema) {
  return (req, res, next) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues || error.errors || [];
        const message = issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
        throw new ApiError(400, message);
      }
      throw error;
    }
  };
}
