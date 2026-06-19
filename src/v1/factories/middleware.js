import pool from "../../db/db.js";
import { ApiError } from "../../utils/ApiError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

export const requireFactoryOwner = asyncHandler(async (req, res, next) => {
  const factoryId = req.params.factoryId;
  const userId = req.user?.id;

  if (!factoryId) {
    throw new ApiError(400, "Factory ID is required");
  }

  if (!userId) {
    throw new ApiError(401, "Authentication is required");
  }

  const result = await pool.query(
    "SELECT id FROM factories WHERE id = $1 AND user_id = $2",
    [factoryId, userId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(403, "You do not have permission to access this factory");
  }

  next();
});
