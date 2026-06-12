import { deleteCachePattern } from "./redisClient.js";

/**
 * Invalidate all cached data related to a specific business.
 * Call this after any write operation (create/update/delete) that affects business data.
 */
export async function invalidateBusinessCache(businessId) {
  await Promise.all([
    deleteCachePattern(`cache:${businessId}:*`),
    deleteCachePattern(`cache:/v1/businesses/${businessId}*`),
  ]);
}

/**
 * Invalidate all dashboard-related caches for a business.
 */
export async function invalidateDashboardCache(businessId) {
  await deleteCachePattern(`dashboard:*:${businessId}:*`);
  await deleteCachePattern(`dashboard:*:${businessId}`);
}

/**
 * Invalidate list caches for a specific resource type within a business.
 * @param {string} businessId
 * @param {string} resource - e.g., "parties", "items", "invoices", "payments", "expenses"
 */
export async function invalidateListCache(businessId, resource) {
  await deleteCachePattern(`cache:/v1/businesses/${businessId}/${resource}*`);
}
