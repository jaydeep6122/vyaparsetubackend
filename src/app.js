import "dotenv/config"; // MUST be first
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import compression from "compression";
import { errorHandler } from "./middlewares/error.middlewares.js";
import authRoutes from "./v1/auth/auth.js";
import businessesRouter from "./v1/businesses/businesses.js";
import logger from "./utils/logger.js";
import { readFileSync } from "fs";

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

// Response compression for faster payload delivery
app.use(compression());

// Development logging
app.use(morgan("dev"));

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

// API routes
app.use("/v1/auth", authRoutes);
app.use("/v1/businesses", businessesRouter);
// Error handling middleware MUST be registered last
app.use(errorHandler);

export default app;
