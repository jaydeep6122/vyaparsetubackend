import { ApiError } from "../utils/ApiError.js";

/**
 * Global Error Handler Middleware.
 * Catches all errors and sends a formatted JSON response.
 */
const errorHandler = (err, req, res, next) => {
  let { statusCode, message } = err;

  // If the error is not an instance of ApiError, default to 500
  if (!(err instanceof ApiError)) {
    statusCode = 500;
    message = err.message || "Internal Server Error";
  }

  const response = {
    success: false,
    statusCode,
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  };

  console.error(`[Error] ${statusCode}: ${message}`);
  if (err.stack) console.error(err.stack);

  res.status(statusCode).json(response);
};

export { errorHandler };
