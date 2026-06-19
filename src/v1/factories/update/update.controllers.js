import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function updateFactory(req, res) {
  const { factoryId } = req.params;
  const { name, location } = req.body;

  if (name === "") {
    throw new ApiError(400, "Name cannot be empty");
  }

  const query = `
    UPDATE factories
    SET
      name = COALESCE($1, name),
      location = COALESCE($2, location),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
    RETURNING *
  `;
  const values = [
    name === undefined ? null : name,
    location === undefined ? null : location,
    factoryId,
  ];

  const result = await pool.query(query, values);

  if (result.rowCount === 0) {
    throw new ApiError(404, "Factory not found");
  }

  res.status(200).json(result.rows[0]);
}
