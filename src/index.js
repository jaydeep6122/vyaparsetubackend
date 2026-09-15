import app from "./app.js";
import pool from "./db/db.js";
import { loadEnv } from "./config/env.js";
import logger from "./utils/logger.js";

const env = loadEnv();

// The schema is owned by migrations (`npm run migrate`), never changed at boot.
async function start() {
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    logger.error(`Cannot reach the database: ${error.message}`);
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    logger.info(`Server running on port ${env.PORT}`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, closing server`);

    // Stop taking new requests, let in-flight ones finish, then close the pool.
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
