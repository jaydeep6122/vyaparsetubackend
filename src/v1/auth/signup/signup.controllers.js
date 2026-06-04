import { createUserService, createRefreshTokenService } from "./signup.services.js";
import { ApiError } from "../../../utils/ApiError.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";

// Generate Access Token (Short-lived)
export const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
};

// Generate Refresh Token (Long-lived)
export const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user.id, jti: crypto.randomUUID() },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

export async function signup(req, res) {
  const { name, email, password, confirmPassword } = req.body;

  if (!name || !email || !password || !confirmPassword) {
    throw new ApiError(400, "Name, email, and password are required");
  }

  if (password !== confirmPassword) {
    throw new ApiError(400, "Password and confirm password do not match");
  }

  const hashedPassword = crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");

  // Create user
  const user = await createUserService(name, email, hashedPassword);

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Decode refresh token to get expires_at
  const decoded = jwt.decode(refreshToken);
  const expiresAt = new Date(decoded.exp * 1000);

  // Device Info
  const deviceInfo = req.body.deviceInfo || req.headers["user-agent"] || "unknown";

  // Store refresh token in database
  await createRefreshTokenService(user.id, refreshToken, deviceInfo, expiresAt);

  res.status(201).json({ user, accessToken, refreshToken });
}
