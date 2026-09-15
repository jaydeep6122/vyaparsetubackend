import jwt from "jsonwebtoken";
import { createHash, randomBytes, randomUUID } from "node:crypto";

export const TOKEN_ISSUER = "vyaparsetu";
const ACCESS_TOKEN_SECONDS = 15 * 60;
const REFRESH_TOKEN_DAYS = 30;

// Each kind of signed token has its own audience, so a share link can never
// be used as an access token or the other way round.
const ACCESS_AUDIENCE = "access";
const SHARE_AUDIENCE = "invoice-share";

export const signAccessToken = (userId) =>
  jwt.sign({}, process.env.JWT_SECRET, {
    subject: userId,
    issuer: TOKEN_ISSUER,
    audience: ACCESS_AUDIENCE,
    expiresIn: ACCESS_TOKEN_SECONDS,
    algorithm: "HS256",
  });

export const verifyAccessToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: TOKEN_ISSUER,
    audience: ACCESS_AUDIENCE,
  });

export const signShareToken = (payload, expiresInSeconds) =>
  jwt.sign(payload, process.env.JWT_SECRET, {
    issuer: TOKEN_ISSUER,
    audience: SHARE_AUDIENCE,
    expiresIn: expiresInSeconds,
    algorithm: "HS256",
  });

/** The token's payload, or null when it is forged, expired or not a share token. */
export function verifyShareToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: SHARE_AUDIENCE,
    });
  } catch {
    return null;
  }
}

/** Refresh tokens are opaque random strings; only their SHA-256 is stored. */
export const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");

export async function issueRefreshToken(db, { userId, familyId, deviceInfo }) {
  const token = randomBytes(32).toString("base64url");
  const {
    rows: [row],
  } = await db.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, device_info, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))
     RETURNING id`,
    [
      userId,
      familyId ?? randomUUID(),
      hashToken(token),
      deviceInfo ?? null,
      REFRESH_TOKEN_DAYS,
    ],
  );
  return { token, id: row.id };
}

export function sessionPayload(userId, refreshToken) {
  return {
    access_token: signAccessToken(userId),
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
  };
}
