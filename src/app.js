import "dotenv/config"; // MUST be first
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middlewares/error.middlewares.js";
import authRoutes from "./v1/auth/auth.js";
import businessesRouter from "./v1/businesses/businesses.js";
import factoriesRouter from "./v1/factories/factories.js";
import logger from "./utils/logger.js";
import { readFileSync } from "fs";
import pool from "./db/db.js";
import { asyncHandler } from "./utils/asyncHandler.js";

const app = express();

// Set security HTTP headers
app.use(helmet());

// Enable CORS
app.use(
  cors({
    origin: "*", // Adjust this to specific domains in production if needed
    credentials: true,
  }),
);

// Development logging
app.use(morgan("dev"));

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

// Global Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per windowMs
  message: "Too many requests from this IP, please try again after 15 minutes",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use(express.json());

// Health check route (only match root path)
app.get("/", (req, res) => {
  res.status(200).json({ message: "Request sent by Cron" });
});

// App version check route
app.get("/v1/app-version", asyncHandler(async (req, res) => {
  const result = await pool.query(
    "SELECT version FROM app_versions ORDER BY created_at DESC LIMIT 1"
  );
  if (result.rows.length === 0) {
    res.status(404).json({ message: "No version information found" });
    return;
  }
  res.status(200).json({ version: result.rows[0].version });
}));

// API routes
app.use("/v1/auth", authRoutes);
app.use("/v1/businesses", businessesRouter);
app.use("/v1/factories", factoriesRouter);
// Error handling middleware MUST be registered last
app.use(errorHandler);

export default app;
