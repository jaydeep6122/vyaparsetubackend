import pool from "../db/db.js";

export const createUserService = async (email, password) => {
  const query = `INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *`;
  const result = await pool.query(query, [email, password]);
  return result.rows[0];
};
