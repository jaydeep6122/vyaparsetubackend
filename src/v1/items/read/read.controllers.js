import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import { getCache, setCache } from "../../../utils/redisClient.js";
import { cacheKeys } from "../../../utils/cacheKeys.js";

export async function listItems(req, res) {
  const { businessId } = req.params;
  const { search } = req.query;

  const cacheKey = cacheKeys.itemList(businessId, search || "");
  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  let query = "SELECT * FROM items WHERE business_id = $1";
  const values = [businessId];
  let paramIndex = 2;

  if (search) {
    query += ` AND name ILIKE $${paramIndex}`;
    values.push(`%${search}%`);
    paramIndex++;
  }

  query += " ORDER BY name ASC";

  const result = await pool.query(query, values);
  await setCache(cacheKey, result.rows, 60);
  res.status(200).json(result.rows);
}

export async function getItemById(req, res) {
  const { businessId, itemId } = req.params;

  const cacheKey = cacheKeys.itemDetail(businessId, itemId);
  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  const result = await pool.query(
    "SELECT * FROM items WHERE id = $1 AND business_id = $2",
    [itemId, businessId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Item not found");
  }

  await setCache(cacheKey, result.rows[0], 60);
  res.status(200).json(result.rows[0]);
}
