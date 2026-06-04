import pool from "../../../db/db.js";

export const findRefreshTokenService = async (token) => {
  const query = `SELECT * FROM refresh_tokens WHERE token = $1`;
  const result = await pool.query(query, [token]);
  return result.rows[0];
};

export const findUserByIdService = async (userId) => {
  const query = `SELECT * FROM users WHERE id = $1`;
  const result = await pool.query(query, [userId]);
  return result.rows[0];
};

export const updateRefreshTokenService = async (tokenId, token, expiresAt, deviceInfo) => {
  const query = `
    UPDATE refresh_tokens 
    SET token = $1, expires_at = $2, device_info = $3, created_at = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING *
  `;
  const result = await pool.query(query, [token, expiresAt, deviceInfo, tokenId]);
  return result.rows[0];
};
