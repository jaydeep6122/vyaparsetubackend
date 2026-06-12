import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import { invalidateBusinessCache } from "../../../utils/cacheInvalidation.js";

export async function deleteBusiness(req, res) {
  const { businessId } = req.params;

  const result = await pool.query(
    "DELETE FROM businesses WHERE id = $1 RETURNING id",
    [businessId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Business not found");
  }

  await invalidateBusinessCache(businessId);
  res.status(204).end();
}
