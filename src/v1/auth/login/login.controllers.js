import { findUserByEmailService, createRefreshTokenService } from "./login.services.js";
import { generateAccessToken, generateRefreshToken } from "../signup/signup.controllers.js";
import { ApiError } from "../../../utils/ApiError.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";

export async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  const user = await findUserByEmailService(email);
  if (!user) {
    throw new ApiError(401, "Invalid email or password");
  }

  if (!user.is_active) {
    throw new ApiError(403, "User account is suspended");
  }

  const hashedPassword = crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");

  if (user.password !== hashedPassword) {
    throw new ApiError(401, "Invalid email or password");
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Decode refresh token to get expires_at
  const decoded = jwt.decode(refreshToken);
  const expiresAt = new Date(decoded.exp * 1000);

  // Device Info
  const deviceInfo = req.body.deviceInfo || req.headers["user-agent"] || "unknown";

  // Store refresh token in database
  await createRefreshTokenService(user.id, refreshToken, deviceInfo, expiresAt);

  // Remove password from user object before returning
  delete user.password;

  res.status(200).json({ user, accessToken, refreshToken });
}
