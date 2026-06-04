import jwt from "jsonwebtoken";
import { ApiError } from "../../../utils/ApiError.js";
import { generateAccessToken, generateRefreshToken } from "../signup/signup.controllers.js";
import { findRefreshTokenService, findUserByIdService, updateRefreshTokenService } from "./refresh.services.js";

export async function refreshSession(req, res) {
  const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

  if (!refreshToken) {
    throw new ApiError(401, "Refresh token is required");
  }

  try {
    // 1. Verify token signature
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );

    // 2. Find token in DB
    const tokenRecord = await findRefreshTokenService(refreshToken);
    if (!tokenRecord) {
      throw new ApiError(403, "Invalid or expired refresh token");
    }

    // 3. Check if revoked
    if (tokenRecord.is_revoked) {
      throw new ApiError(403, "Refresh token has been revoked");
    }

    // 4. Check if expired
    if (new Date(tokenRecord.expires_at) < new Date()) {
      throw new ApiError(403, "Refresh token has expired");
    }

    // 5. Find user
    const user = await findUserByIdService(tokenRecord.user_id);
    if (!user) {
      throw new ApiError(403, "User not found");
    }

    if (!user.is_active) {
      throw new ApiError(403, "User account is suspended");
    }

    // 6. Generate new tokens
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    const decodedNew = jwt.decode(newRefreshToken);
    const expiresAt = new Date(decodedNew.exp * 1000);

    const deviceInfo = req.body.deviceInfo || req.headers["user-agent"] || tokenRecord.device_info || "unknown";

    // 7. Update token record in database (Token Rotation)
    await updateRefreshTokenService(tokenRecord.id, newRefreshToken, expiresAt, deviceInfo);

    // Set cookie if original was cookie-based
    if (req.cookies?.refreshToken) {
      res.cookie("refreshToken", newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }

    res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(403, "Invalid or expired refresh token");
  }
}
