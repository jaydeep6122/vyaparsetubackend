import { ApiError } from "../utils/ApiError.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks that the named route params are UUIDs (anything else is simply not
 * found) and lowercases them so they compare equal to ids from the database.
 */
export const idParams =
  (...names) =>
  (req, res, next) => {
    for (const name of names) {
      const value = req.params[name];
      if (!UUID_RE.test(value ?? "")) throw new ApiError(404, "Not found");
      req.params[name] = value.toLowerCase();
    }
    next();
  };
