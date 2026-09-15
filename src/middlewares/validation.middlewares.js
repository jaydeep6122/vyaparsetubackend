import { ApiError } from "../utils/ApiError.js";

const formatIssues = (error) =>
  error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join(", ");

/**
 * Validates `req[source]` ("body", "params" or "query") and replaces it with
 * the parsed result, so zod defaults, coercions and the stripping of unknown
 * keys actually reach the controller.
 */
export function validate(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      throw new ApiError(400, formatIssues(result.error));
    }

    // Express 5 exposes req.query through a getter, so plain assignment is
    // silently ignored; redefine the property instead.
    Object.defineProperty(req, source, {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}
