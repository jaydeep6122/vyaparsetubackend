import pool from "./db.js";
import logger from "../utils/logger.js";

/**
 * Runs `fn(client)` inside BEGIN/COMMIT and always returns the client.
 *
 * `readOnly` gives reports one consistent snapshot across several queries.
 *
 * If ROLLBACK itself fails the connection is broken, so it is released with
 * the error and the pool destroys it instead of handing it to the next request.
 * The original error is always the one rethrown.
 */
export async function withTransaction(fn, { readOnly = false } = {}) {
  const client = await pool.connect();
  let brokenConnection;

  try {
    await client.query(
      readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN",
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      brokenConnection = rollbackError;
      logger.error(`[DB] ROLLBACK failed: ${rollbackError.message}`);
    }
    throw error;
  } finally {
    client.release(brokenConnection);
  }
}
