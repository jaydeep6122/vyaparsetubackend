import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import { getCache, setCache } from "../../../utils/redisClient.js";
import { cacheKeys } from "../../../utils/cacheKeys.js";

export async function listPayments(req, res) {
  const { businessId } = req.params;
  const { payment_type, party_id, from_date, to_date } = req.query;

  const queryString = `${payment_type || ""}:${party_id || ""}:${from_date || ""}:${to_date || ""}`;
  const cacheKey = cacheKeys.paymentList(businessId, queryString);
  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  let query = `
    SELECT pay.*, p.name as party_name 
    FROM payments pay
    LEFT JOIN parties p ON pay.party_id = p.id
    WHERE pay.business_id = $1
  `;
  const values = [businessId];
  let paramIndex = 2;

  if (payment_type) {
    query += ` AND pay.payment_type = $${paramIndex}`;
    values.push(payment_type);
    paramIndex++;
  }

  if (party_id) {
    query += ` AND pay.party_id = $${paramIndex}`;
    values.push(party_id);
    paramIndex++;
  }

  if (from_date) {
    query += ` AND pay.payment_date >= $${paramIndex}`;
    values.push(new Date(from_date));
    paramIndex++;
  }

  if (to_date) {
    query += ` AND pay.payment_date <= $${paramIndex}`;
    values.push(new Date(to_date));
    paramIndex++;
  }

  query += " ORDER BY pay.payment_date DESC, pay.created_at DESC";

  const result = await pool.query(query, values);
  await setCache(cacheKey, result.rows, 60);
  res.status(200).json(result.rows);
}
