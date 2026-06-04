import pool from "../../../db/db.js";

export const revokeSingleTokenService = async (token) => {
  const query = `
    UPDATE refresh_tokens 
    SET is_revoked = true 
    WHERE token = $1 
    RETURNING *
  `;
  const result = await pool.query(query, [token]);
  return result.rows[0];
};

export const revokeAllUserTokensService = async (userId) => {
  const query = `
    UPDATE refresh_tokens 
    SET is_revoked = true 
    WHERE user_id = $1 
    RETURNING *
  `;
  const result = await pool.query(query, [userId]);
  return result.rows;
};
