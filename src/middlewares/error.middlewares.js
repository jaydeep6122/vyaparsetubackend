import { ApiError } from "../utils/ApiError.js";
import logger from "../utils/logger.js";

// Postgres error codes the client can act on. Anything else is a 500 whose
// message is never sent back, since raw driver text leaks schema details.
const PG_ERRORS = {
  23505: [409, "A record with the same value already exists"],
  23514: [400, "The data breaks a validation rule"],
  23502: [400, "A required field is missing"],
  "22P02": [400, "Invalid input format"],
  22001: [400, "A value is too long"],
  22003: [400, "A numeric value is out of range"],
  22007: [400, "Invalid date or time"],
  22008: [400, "Date or time is out of range"],
  40001: [503, "The record was changed by another request, please retry"],
  "40P01": [503, "The record was changed by another request, please retry"],
};

function classify(err) {
  if (err instanceof ApiError) {
    return { statusCode: err.statusCode, message: err.message };
  }

  if (err.type === "entity.parse.failed") {
    return { statusCode: 400, message: "Malformed JSON body" };
  }
  if (err.type === "entity.too.large") {
    return { statusCode: 413, message: "Request body is too large" };
  }

  if (err.code === "23503") {
    // Same code for "you referenced something missing" and "something still
    // references this row"; only the detail text tells them apart.
    const stillReferenced = /still referenced/i.test(err.detail || "");
    return stillReferenced
      ? { statusCode: 409, message: "This record is used by other records", constraint: err.constraint }
      : { statusCode: 400, message: "A referenced record does not exist", constraint: err.constraint };
  }

  if (PG_ERRORS[err.code]) {
    const [statusCode, message] = PG_ERRORS[err.code];
    return { statusCode, message, constraint: err.constraint };
  }

  return { statusCode: 500, message: "Internal Server Error" };
}

/** JSON 404 for routes nothing matched. */
const notFoundHandler = (req, res, next) => {
  next(new ApiError(404, `Route ${req.method} ${req.originalUrl} not found`));
};

/**
 * Global Error Handler Middleware.
 * Catches all errors and sends a formatted JSON response.
 */
const errorHandler = (err, req, res, next) => {
  const { statusCode, message, constraint } = classify(err);

  const logMeta = { url: req.originalUrl, method: req.method, code: err.code };
  if (statusCode >= 500) {
    logger.error(`[Error] ${statusCode}: ${err.message}`, { ...logMeta, stack: err.stack });
  } else {
    logger.warn(`[Error] ${statusCode}: ${message}`, logMeta);
  }

  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    ...(constraint && { constraint }),
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

export { errorHandler, notFoundHandler };
