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

export const requireBusinessOwner = asyncHandler(async (req, res, next) => {
  const businessId = req.params.businessId || req.body.businessId || req.query.businessId;
  const userId = req.user?.id;

  if (!businessId) {
    throw new ApiError(400, "Business ID is required");
  }

  if (!userId) {
    throw new ApiError(401, "Authentication is required");
  }

  const query = "SELECT id FROM businesses WHERE id = $1 AND user_id = $2";
  const result = await pool.query(query, [businessId, userId]);

  if (result.rowCount === 0) {
    throw new ApiError(403, "You do not have permission to access this business");
  }

  next();
});

export const requireFactoryOwner = asyncHandler(async (req, res, next) => {
  const factoryId = req.params.factoryId || req.body.factoryId || req.query.factoryId;
  const userId = req.user?.id;

  if (!factoryId) {
    throw new ApiError(400, "Factory ID is required");
  }

  if (!userId) {
    throw new ApiError(401, "Authentication is required");
  }

  const query = "SELECT id FROM kiln_factories WHERE id = $1 AND user_id = $2";
  const result = await pool.query(query, [factoryId, userId]);

  if (result.rowCount === 0) {
    throw new ApiError(403, "You do not have permission to access this factory");
  }

  next();
});


