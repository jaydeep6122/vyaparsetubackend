import pool from "../../../db/db.js";

export const findUserByEmailService = async (email) => {
  const query = `SELECT * FROM users WHERE email = $1`;
  const result = await pool.query(query, [email]);
  return result.rows[0];
};

export const createRefreshTokenService = async (userId, token, deviceInfo, expiresAt) => {
  const query = `
    INSERT INTO refresh_tokens (user_id, token, device_info, expires_at)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const result = await pool.query(query, [userId, token, deviceInfo, expiresAt]);
  return result.rows[0];
};
