#!/usr/bin/env node
/**
 * Empties every table in the database DATABASE_URL points at, keeping the
 * schema and the migration history. There is no undo and no backup: this is
 * for clearing test data before going live.
 *
 *   npm run reset:data                 # shows the target and does nothing
 *   CONFIRM=yes npm run reset:data     # actually empties it
 *   CONFIRM=yes KEEP_USERS=yes npm run reset:data   # keeps logins
 *
 * Point it at a database by exporting DATABASE_URL for the command, e.g.
 *   DATABASE_URL='postgres://...' CONFIRM=yes npm run reset:data
 */
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config({ quiet: true });

const { Client } = pkg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

// Tables that must survive: the migration history, and optionally logins.
const KEEP = ["pgmigrations", ...(process.env.KEEP_USERS === "yes" ? ["users"] : [])];

const target = new URL(connectionString);
const host = target.hostname;
const database = target.pathname.replace("/", "");
const isLocal = host === "localhost" || host === "127.0.0.1";

const client = new Client({
  connectionString,
  // Managed databases (Render, Supabase, Neon) need TLS from outside.
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

// One query at a time: a single client cannot run them in parallel.
const rowCounts = async (tables) => {
  const counts = [];
  for (const table of tables) {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
    if (rows[0].count > 0) counts.push([table, rows[0].count]);
  }
  return counts;
};

async function main() {
  await client.connect();

  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> ALL($1::text[])
     ORDER BY tablename`,
    [KEEP],
  );
  const tables = rows.map((row) => row.tablename);
  if (tables.length === 0) {
    console.log("Nothing to empty.");
    return;
  }

  const before = await rowCounts(tables);
  console.log(`\nDatabase : ${database}`);
  console.log(`Host     : ${host}${isLocal ? " (local)" : ""}`);
  console.log(`Keeping  : ${KEEP.join(", ")}`);
  console.log(`Tables   : ${tables.length}, of which ${before.length} hold rows`);
  for (const [table, count] of before) console.log(`  ${table}: ${count}`);

  if (process.env.CONFIRM !== "yes") {
    console.log("\nNothing was changed. Re-run with CONFIRM=yes to empty the tables above.\n");
    process.exitCode = 1;
    return;
  }

  // One statement so foreign keys never see a half-empty database.
  const list = tables.map((table) => `"${table}"`).join(", ");
  await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  const after = await rowCounts(tables);
  console.log(
    after.length === 0
      ? "\nDone. Every table above is empty.\n"
      : `\nDone, but these still hold rows: ${after.map(([table]) => table).join(", ")}\n`,
  );
}

main()
  .catch((error) => {
    console.error(`Reset failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => client.end());
