import pool from "../../../db/db.js";

export async function createFactory(req, res) {
  const { name, location } = req.body;
  const userId = req.user.id;

  const query = `
    INSERT INTO kiln_factories (user_id, name, location)
    VALUES ($1, $2, $3)
    RETURNING *
  `;
  const values = [userId, name, location || null];

  const result = await pool.query(query, values);
  res.status(201).json(result.rows[0]);
}
