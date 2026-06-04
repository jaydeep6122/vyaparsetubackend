import pool from "../../../db/db.js";

export const createUserService = async (name, email, password) => {
  const query = `
    INSERT INTO users (name, email, password) 
    VALUES ($1, $2, $3) 
    RETURNING id, name, email, is_active, created_at, updated_at
  `;
  const result = await pool.query(query, [name, email, password]);
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
