import pool from "../db/db.js";
import { ApiError } from "../utils/ApiError.js";
import { verifyAccessToken } from "../services/tokens.js";

export const ROLE_RANK = { staff: 1, accountant: 2, admin: 3, owner: 4 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new ApiError(401, "Authorization token is required");
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (error) {
    throw new ApiError(
      401,
      error.name === "TokenExpiredError" ? "Access token expired" : "Invalid access token",
    );
  }

  const {
    rows: [user],
  } = await pool.query(
    "SELECT id, name, email, phone, is_active FROM users WHERE id = $1",
    [payload.sub],
  );
  if (!user) throw new ApiError(401, "Invalid access token");
  if (!user.is_active) throw new ApiError(403, "User account is suspended");

  req.user = user;
  next();
}

/**
 * Loads `:businessId` for an active member. Non-members get 404, not 403, so
 * business ids cannot be probed.
 */
export async function loadBusiness(req, res, next) {
  const { businessId } = req.params;
  if (!UUID_RE.test(businessId)) throw new ApiError(404, "Business not found");

  const {
    rows: [row],
  } = await pool.query(
    `SELECT b.*, m.role
     FROM businesses b
     JOIN business_members m
       ON m.business_id = b.id AND m.user_id = $2 AND m.status = 'active'
     WHERE b.id = $1 AND b.archived_at IS NULL`,
    [businessId.toLowerCase(), req.user.id],
  );
  if (!row) throw new ApiError(404, "Business not found");

  const { role, ...business } = row;
  req.business = business;
  req.role = role;
  next();
}

/** owner > admin > accountant > staff */
export const hasRole = (role, minimum) => ROLE_RANK[role] >= ROLE_RANK[minimum];

export const requireRole = (minimum) => (req, res, next) => {
  if (!hasRole(req.role, minimum)) {
    throw new ApiError(403, `This action needs the ${minimum} role or higher`);
  }
  next();
};
