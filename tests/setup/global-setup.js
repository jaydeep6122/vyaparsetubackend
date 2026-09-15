import dotenv from "dotenv";
import { runner } from "node-pg-migrate";

/** Brings the test database up to the latest migration once per run. */
export default async function globalSetup() {
  dotenv.config({ quiet: true });

  const databaseUrl = process.env.DATABASE_URL_TEST;
  if (!databaseUrl) {
    throw new Error("Set DATABASE_URL_TEST to a throwaway database before running tests");
  }
  if (databaseUrl === process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL_TEST must not be the same database as DATABASE_URL");
  }

  await runner({
    databaseUrl,
    dir: "migrations",
    direction: "up",
    migrationsTable: "pgmigrations",
    count: Infinity,
    verbose: false,
    log: () => {},
  });
}
