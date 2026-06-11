import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function listBusinesses(req, res) {
  const userId = req.user.id;
  const result = await pool.query(
    "SELECT * FROM businesses WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  res.status(200).json(result.rows);
}

export async function getBusinessById(req, res) {
  const { businessId } = req.params;
  const result = await pool.query("SELECT * FROM businesses WHERE id = $1", [
    businessId,
  ]);
  
  if (result.rowCount === 0) {
    throw new ApiError(404, "Business not found");
  }
  
  res.status(200).json(result.rows[0]);
}
