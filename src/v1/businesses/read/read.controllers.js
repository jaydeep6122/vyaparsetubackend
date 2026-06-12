import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import { getCache, setCache } from "../../../utils/redisClient.js";
import { cacheKeys } from "../../../utils/cacheKeys.js";

export async function listBusinesses(req, res) {
  const userId = req.user.id;

  const cacheKey = cacheKeys.businessList(userId);
  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  const result = await pool.query(
    "SELECT * FROM businesses WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );

  await setCache(cacheKey, result.rows, 120);
  res.status(200).json(result.rows);
}

export async function getBusinessById(req, res) {
  const { businessId } = req.params;

  const cacheKey = cacheKeys.businessDetail(businessId);
  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  const result = await pool.query("SELECT * FROM businesses WHERE id = $1", [
    businessId,
  ]);

  if (result.rowCount === 0) {
    throw new ApiError(404, "Business not found");
  }

  await setCache(cacheKey, result.rows[0], 120);
  res.status(200).json(result.rows[0]);
}
