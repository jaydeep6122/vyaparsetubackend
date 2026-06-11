import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function deleteParty(req, res) {
  const { businessId, partyId } = req.params;

  const result = await pool.query(
    "DELETE FROM parties WHERE id = $1 AND business_id = $2 RETURNING id",
    [partyId, businessId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Party not found");
  }

  res.status(204).end();
}
