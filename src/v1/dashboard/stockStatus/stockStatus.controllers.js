import { getCache, setCache } from "../../../utils/redisClient.js";
import { cacheKeys } from "../../../utils/cacheKeys.js";

export async function getStockStatusReport(req, res) {
  const { businessId } = req.params;

  const cacheKey = cacheKeys.dashboardStockStatus(businessId);
  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  // Stock tracking has been removed; return empty response
  const result = {
    low_stock_items: [],
    out_of_stock_items: [],
    total_items: 0,
  };

  await setCache(cacheKey, result, 300);

  res.status(200).json(result);
}
