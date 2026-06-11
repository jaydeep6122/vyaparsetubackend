import app from "./app.js";
import { ensureSchema } from "./db/ensureSchema.js";
import logger from "./utils/logger.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  try {
    await ensureSchema();
    logger.info("Database schema verified successfully");
  } catch (error) {
    logger.error("Database schema verification failed during startup:", error);
  }
});
