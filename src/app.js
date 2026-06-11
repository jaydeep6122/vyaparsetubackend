import "dotenv/config"; // MUST be first
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middlewares/error.middlewares.js";
import authRoutes from "./v1/auth/auth.js";
import businessesRouter from "./v1/businesses/businesses.js";
import { ensureSchema } from "./db/ensureSchema.js";

// Run DB schema checks on startup
ensureSchema();

const app = express();

// Set security HTTP headers
app.use(helmet());

// Enable CORS
app.use(cors({
  origin: "*", // Adjust this to specific domains in production if needed
  credentials: true,
}));

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

app.use("/v1/auth", authRoutes);
app.use("/v1/businesses", businessesRouter);

// Error handling middleware MUST be registered last
app.use(errorHandler);

export default app;
