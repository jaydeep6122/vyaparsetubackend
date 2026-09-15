import dotenv from "dotenv";

// Runs before every test file. The app reads DATABASE_URL, so it is pointed
// at the test database here, before anything imports the pool. dotenv never
// overrides variables that are already set.
dotenv.config({ quiet: true });

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error("Set DATABASE_URL_TEST to a throwaway database before running tests");
}
if (testUrl === process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL_TEST must not be the same database as DATABASE_URL");
}

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "test-only-secret-0123456789abcdef0123456789";
process.env.LOG_LEVEL = "error";
