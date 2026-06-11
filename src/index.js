import app from "./app.js";
import { ensureSchema } from "./db/ensureSchema.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await ensureSchema();
  } catch (error) {
    console.error("Database schema verification failed during startup:", error);
  }
});
