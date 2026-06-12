import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import { invalidateBusinessCache } from "../../../utils/cacheInvalidation.js";

export async function deleteItem(req, res) {
  const { businessId, itemId } = req.params;

  const result = await pool.query(
    "DELETE FROM items WHERE id = $1 AND business_id = $2 RETURNING id",
    [itemId, businessId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Item not found");
  }

  await invalidateBusinessCache(businessId);
  res.status(204).end();
}
