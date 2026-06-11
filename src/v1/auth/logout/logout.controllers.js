import jwt from "jsonwebtoken";
import { ApiError } from "../../../utils/ApiError.js";
import { revokeSingleTokenService, revokeAllUserTokensService } from "./logout.services.js";

export async function logout(req, res) {
  const refreshToken = req.cookies?.refreshToken || req.body.refresh_token || req.body.refreshToken;
  const { allDevices } = req.body;

  if (!refreshToken) {
    throw new ApiError(400, "Refresh token is required for logout");
  }

  try {
    // Verify the token to get the user context
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );
    const userId = decoded.id;

    if (allDevices === true || allDevices === "true") {
      // Logout from all devices: revoke all tokens for this user
      await revokeAllUserTokensService(userId);
    } else {
      // Logout this device only: revoke only this token
      await revokeSingleTokenService(refreshToken);
    }
  } catch (error) {
    // If the token is already invalid or expired, we still try to revoke the exact token string if it exists in DB
    // to be safe, but we don't throw an error to the user (since they want to be logged out anyway).
    if (refreshToken) {
      try {
        await revokeSingleTokenService(refreshToken);
      } catch (dbErr) {
        // Ignore DB error
      }
    }
  }

  // Clear cookie if present
  if (req.cookies?.refreshToken) {
    res.clearCookie("refreshToken");
  }

  res.status(200).json({ message: "Logged out successfully" });
}
