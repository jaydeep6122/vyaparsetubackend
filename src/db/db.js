import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // maxUses is not a standard pg option, but we can handle connection recycling differently if needed
});

// Handle pool errors to prevent app crashes
pool.on("error", (err, client) => {
  console.error("Unexpected PostgreSQL pool error:", err.message);
});

export default pool;
