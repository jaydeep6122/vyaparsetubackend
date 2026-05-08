import "dotenv/config"; // MUST be first
import express from "express";
import { errorHandler } from "./middlewares/error.middlewares.js";
import signupRoutes from "./routes/signup.js";

const app = express();
app.use(express.json());

app.use("/signup", signupRoutes);

// Error handling middleware MUST be registered last
app.use(errorHandler);

export default app;
