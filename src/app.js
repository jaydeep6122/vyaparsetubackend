import "dotenv/config"; // MUST be first
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { errorHandler, notFoundHandler } from "./middlewares/error.middlewares.js";
import authRouter from "./v1/auth/auth.routes.js";
import businessesRouter from "./v1/businesses/businesses.routes.js";
import invitesRouter from "./v1/invites/invites.routes.js";
import publicRouter from "./v1/public/public.routes.js";
import pool from "./db/db.js";

const app = express();

// Requests arrive through the hosting provider's proxy. Without this every
// client shares the proxy's IP, and so a single rate-limit bucket.
app.set("trust proxy", 1);

// Set security HTTP headers
app.use(helmet());

// The mobile app sends no Origin header, so CORS only affects browsers.
// CORS_ORIGINS is a comma-separated allowlist; without it any origin may call
// the API, but never with credentials.
const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors(
    corsOrigins.length > 0
      ? { origin: corsOrigins, credentials: true }
      : { origin: "*" },
  ),
);

if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

// Custom Response Time Middleware to inject response duration headers
app.use((req, res, next) => {
  const start = process.hrtime();
  let headerSet = false;

  const setResponseTimeHeader = () => {
    if (headerSet) return;
    const diff = process.hrtime(start);
    const timeInMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);
    res.setHeader("X-Response-Time", `${timeInMs}ms`);
    headerSet = true;
  };

  // Intercept writeHead to set header before response is sent
  const originalWriteHead = res.writeHead;
  res.writeHead = function (...args) {
    setResponseTimeHeader();
    return originalWriteHead.apply(this, args);
  };

  next();
});

const isHealthCheck = (req) => req.path === "/" || req.path === "/health";
// The test suite makes hundreds of requests from one address.
const isTestRun = () => process.env.NODE_ENV === "test";

// Global Rate Limiting (per client IP)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  message: { success: false, statusCode: 429, message: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isTestRun() || isHealthCheck(req),
});
app.use(limiter);

// Password guessing gets a much smaller budget than normal API use.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, statusCode: 429, message: "Too many attempts, please try again after 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestRun,
});
app.use(
  ["/v1/auth/login", "/v1/auth/signup", "/v1/auth/password/forgot", "/v1/auth/password/reset"],
  authLimiter,
);

app.use(express.json({ limit: "1mb" }));

// Pinged by the keep-alive cron (only match root path)
app.get("/", (req, res) => {
  res.status(200).json({ message: "Request sent by Cron" });
});

// Health check that also proves the database is reachable
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", database: "ok" });
  } catch {
    res.status(503).json({ status: "error", database: "unreachable" });
  }
});

// API routes
app.use("/v1/auth", authRouter);
app.use("/v1/businesses", businessesRouter);
app.use("/v1/invites", invitesRouter);
// Unauthenticated: signed share links only.
app.use("/v1/public", publicRouter);

// 404 and error handling middleware MUST be registered last
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
