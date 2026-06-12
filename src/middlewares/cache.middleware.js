import { getCache, setCache, isRedisReady } from "../utils/redisClient.js";
import logger from "../utils/logger.js";

/**
 * Express middleware to cache GET responses.
 * Skips caching if Redis is not available.
 *
 * @param {number} ttlSeconds - Cache time-to-live in seconds (default: 300)
 * @param {function} keyGenerator - Optional custom key generator function (req) => string
 */
export function cacheResponse(ttlSeconds = 300, keyGenerator = null) {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== "GET") {
      return next();
    }

    if (!isRedisReady()) {
      return next();
    }

    const cacheKey = keyGenerator
      ? keyGenerator(req)
      : `cache:${req.originalUrl || req.url}`;

    try {
      const cached = await getCache(cacheKey);
      if (cached !== null) {
        logger.debug(`Cache HIT for key: ${cacheKey}`);
        return res.status(200).json(cached);
      }

      // Override res.json to intercept and cache the response
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        // Restore original json to prevent infinite recursion
        res.json = originalJson;

        // Cache the response asynchronously (don't block)
        setCache(cacheKey, body, ttlSeconds).catch((err) => {
          logger.error(`Failed to cache response for ${cacheKey}:`, err.message);
        });

        return res.json(body);
      };

      next();
    } catch (err) {
      logger.error(`Cache middleware error for ${cacheKey}:`, err.message);
      next();
    }
  };
}
