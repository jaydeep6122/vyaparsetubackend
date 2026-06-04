import jwt from "jsonwebtoken";
import pool from "../db/db.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const requireAuth = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "Authorization token is required");
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const query = "SELECT id, name, email, is_active FROM users WHERE id = $1";
    const result = await pool.query(query, [decoded.id]);
    const user = result.rows[0];

    if (!user) {
      throw new ApiError(401, "User not found");
    }

    if (!user.is_active) {
      throw new ApiError(403, "User account is suspended");
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new ApiError(401, "Access token expired");
    }
    throw new ApiError(401, "Invalid access token");
  }
});
