import pool from "../../../db/db.js";

export const createFactoryService = async (userId, { name, location }) => {
  const query = `
    INSERT INTO factories (user_id, name, location)
    VALUES ($1, $2, $3)
    RETURNING *
  `;
  const values = [userId, name, location || null];
  const result = await pool.query(query, values);
  return result.rows[0];
};
