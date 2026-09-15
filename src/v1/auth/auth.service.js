import pool from "../../db/db.js";
import { setClause } from "../../db/sql.js";
import { withTransaction } from "../../db/transaction.js";
import { audit } from "../../services/audit.js";
import { hashToken, issueRefreshToken, sessionPayload } from "../../services/tokens.js";
import { ApiError } from "../../utils/ApiError.js";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "../../utils/password.js";

const USER_COLUMNS = "id, name, email, phone, is_active, created_at";

// A rotated refresh token presented again within this window is treated as a
// client retry (two requests racing) rather than a stolen token.
const REUSE_GRACE_SECONDS = 30;

async function startSession(client, userId, deviceInfo) {
  const refresh = await issueRefreshToken(client, { userId, deviceInfo });
  return sessionPayload(userId, refresh.token);
}

export async function signup({ name, email, phone, password, device_info }) {
  const passwordHash = await hashPassword(password);

  return withTransaction(async (client) => {
    const {
      rows: [user],
    } = await client.query(
      `INSERT INTO users (name, email, phone, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING ${USER_COLUMNS}`,
      [name, email, phone ?? null, passwordHash],
    );
    if (!user) throw new ApiError(409, "An account with this email already exists");

    await audit(client, { userId: user.id, action: "signup", entityType: "user", entityId: user.id });
    return { user, ...(await startSession(client, user.id, device_info)) };
  });
}

export async function login({ email, password, device_info }) {
  const {
    rows: [user],
  } = await pool.query(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`, [email]);

  const valid = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyAgainstDummy(password);
  if (!valid) throw new ApiError(401, "Invalid email or password");
  if (!user.is_active) throw new ApiError(403, "User account is suspended");

  const { password_hash, ...publicUser } = user;
  return withTransaction(async (client) => {
    await client.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
    await client.query("DELETE FROM refresh_tokens WHERE user_id = $1 AND expires_at < now()", [user.id]);
    return { user: publicUser, ...(await startSession(client, user.id, device_info)) };
  });
}

export async function refresh({ refresh_token, device_info }) {
  // Failures are returned, not thrown, so a family revocation still commits.
  const outcome = await withTransaction(async (client) => {
    const {
      rows: [token],
    } = await client.query(
      `SELECT t.*, u.is_active,
              t.revoked_at < now() - make_interval(secs => $2) AS past_grace
       FROM refresh_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1
       FOR UPDATE OF t`,
      [hashToken(refresh_token), REUSE_GRACE_SECONDS],
    );

    if (!token) return { error: [401, "Invalid refresh token"] };

    if (token.revoked_at) {
      if (token.replaced_by_id && token.past_grace) {
        // An already-rotated token came back: someone else may hold the
        // chain, so every session descended from this sign-in is ended.
        await client.query(
          "UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL",
          [token.family_id],
        );
        return { error: [401, "Refresh token was reused; please sign in again"] };
      }
      return { error: [401, "Refresh token has been revoked"] };
    }
    if (new Date(token.expires_at) <= new Date()) return { error: [401, "Refresh token expired"] };
    if (!token.is_active) return { error: [403, "User account is suspended"] };

    const next = await issueRefreshToken(client, {
      userId: token.user_id,
      familyId: token.family_id,
      deviceInfo: device_info ?? token.device_info,
    });
    await client.query(
      "UPDATE refresh_tokens SET revoked_at = now(), replaced_by_id = $2 WHERE id = $1",
      [token.id, next.id],
    );
    return { session: sessionPayload(token.user_id, next.token) };
  });

  if (outcome.error) throw new ApiError(...outcome.error);
  return outcome.session;
}

/** Idempotent: an unknown or already revoked token is not an error. */
export async function logout({ refresh_token, all_devices }) {
  const {
    rows: [token],
  } = await pool.query("SELECT id, user_id FROM refresh_tokens WHERE token_hash = $1", [
    hashToken(refresh_token),
  ]);
  if (!token) return;

  if (all_devices) {
    await pool.query(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [token.user_id],
    );
  } else {
    await pool.query(
      "UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1",
      [token.id],
    );
  }
}

export async function getMe(userId) {
  const {
    rows: [user],
  } = await pool.query(`SELECT ${USER_COLUMNS}, last_login_at FROM users WHERE id = $1`, [userId]);
  return user;
}

export async function updateMe(userId, data) {
  const set = setClause(data, ["name", "phone"]);
  if (set.keys.length > 0) {
    await pool.query(`UPDATE users SET ${set.sql} WHERE id = $${set.keys.length + 1}`, [
      ...set.values,
      userId,
    ]);
  }
  return getMe(userId);
}

/** Changing the password signs out every other session. */
export async function changePassword(userId, { current_password, new_password, device_info }) {
  const {
    rows: [user],
  } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
  if (!(await verifyPassword(current_password, user.password_hash))) {
    throw new ApiError(400, "Current password is incorrect");
  }
  const passwordHash = await hashPassword(new_password);

  return withTransaction(async (client) => {
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, userId]);
    await client.query(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [userId],
    );
    await audit(client, { userId, action: "change_password", entityType: "user", entityId: userId });
    return startSession(client, userId, device_info);
  });
}
