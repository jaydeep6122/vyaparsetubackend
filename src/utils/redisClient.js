import Redis from "ioredis";
import logger from "./logger.js";

const redisUrl = process.env.REDIS_URL || process.env.REDIS_TLS_URL;

let redisClient = null;
let isRedisConnected = false;

if (redisUrl) {
  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    reconnectOnError(err) {
      const targetErrors = ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND"];
      return targetErrors.some(e => err.message.includes(e));
    },
  });

  redisClient.on("connect", () => {
    isRedisConnected = true;
    logger.info("Redis client connected");
  });

  redisClient.on("error", (err) => {
    isRedisConnected = false;
    logger.error("Redis connection error:", err.message);
  });

  redisClient.on("close", () => {
    isRedisConnected = false;
    logger.warn("Redis connection closed");
  });
} else {
  logger.warn("REDIS_URL not set. Running without Redis caching.");
}

/**
 * Check if Redis is available and connected.
 */
export function isRedisReady() {
  return isRedisConnected && redisClient && redisClient.status === "ready";
}

/**
 * Get cached data by key.
 * @param {string} key - Cache key
 * @returns {Promise<any>} - Parsed cached data or null
 */
export async function getCache(key) {
  if (!isRedisReady()) return null;
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error(`Redis GET error for key ${key}:`, err.message);
    return null;
  }
}

/**
 * Set cache with optional TTL.
 * @param {string} key - Cache key
 * @param {any} value - Data to cache
 * @param {number} ttlSeconds - Time to live in seconds (default: 300 = 5 minutes)
 */
export async function setCache(key, value, ttlSeconds = 300) {
  if (!isRedisReady()) return;
  try {
    await redisClient.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    logger.error(`Redis SET error for key ${key}:`, err.message);
  }
}

/**
 * Delete a specific cache key.
 * @param {string} key - Cache key to delete
 */
export async function deleteCache(key) {
  if (!isRedisReady()) return;
  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error(`Redis DEL error for key ${key}:`, err.message);
  }
}

/**
 * Delete all cache keys matching a pattern.
 * @param {string} pattern - Redis key pattern (e.g., "cache:business:*")
 */
export async function deleteCachePattern(pattern) {
  if (!isRedisReady()) return;
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  } catch (err) {
    logger.error(`Redis DEL pattern error for ${pattern}:`, err.message);
  }
}

/**
 * Flush the entire Redis database (use with caution).
 */
export async function flushCache() {
  if (!isRedisReady()) return;
  try {
    await redisClient.flushdb();
    logger.info("Redis cache flushed");
  } catch (err) {
    logger.error("Redis FLUSHDB error:", err.message);
  }
}

export default redisClient;
