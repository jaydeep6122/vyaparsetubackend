import "dotenv/config"; // MUST be first
import express from "express";
import { errorHandler } from "./middlewares/error.middlewares.js";
import authRoutes from "./v1/auth/auth.js";
import { ensureSchema } from "./db/ensureSchema.js";

// Run DB schema checks on startup
ensureSchema();

const app = express();
app.use(express.json());

app.use("/v1/auth", authRoutes);

// Error handling middleware MUST be registered last
app.use(errorHandler);

export default app;
