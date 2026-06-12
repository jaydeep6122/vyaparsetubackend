import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import { getCache, setCache } from "../../../utils/redisClient.js";
import { cacheKeys } from "../../../utils/cacheKeys.js";

export async function listInvoices(req, res) {
  const { businessId } = req.params;
  const { invoice_type, party_id, from_date, to_date, search } = req.query;

  const queryString = `${invoice_type || ""}:${party_id || ""}:${from_date || ""}:${to_date || ""}:${search || ""}`;
  const cacheKey = cacheKeys.invoiceList(businessId, queryString);
  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  let query = `
    SELECT i.*, p.name as party_name 
    FROM invoices i
    LEFT JOIN parties p ON i.party_id = p.id
    WHERE i.business_id = $1
  `;
  const values = [businessId];
  let paramIndex = 2;

  if (invoice_type) {
    query += ` AND i.invoice_type = $${paramIndex}`;
    values.push(invoice_type);
    paramIndex++;
  }

  if (party_id) {
    query += ` AND i.party_id = $${paramIndex}`;
    values.push(party_id);
    paramIndex++;
  }

  if (from_date) {
    query += ` AND i.invoice_date >= $${paramIndex}`;
    values.push(new Date(from_date));
    paramIndex++;
  }

  if (to_date) {
    query += ` AND i.invoice_date <= $${paramIndex}`;
    values.push(new Date(to_date));
    paramIndex++;
  }

  if (search) {
    query += ` AND i.invoice_number ILIKE $${paramIndex}`;
    values.push(`%${search}%`);
    paramIndex++;
  }

  query += " ORDER BY i.invoice_date DESC, i.created_at DESC";

  const result = await pool.query(query, values);
  await setCache(cacheKey, result.rows, 60);
  res.status(200).json(result.rows);
}

export async function getInvoiceById(req, res) {
  const { businessId, invoiceId } = req.params;

  const cacheKey = cacheKeys.invoiceDetail(businessId, invoiceId);
  const cached = await getCache(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  const query = `
    SELECT i.*, p.name as party_name,
      COALESCE(
        json_agg(
          json_build_object(
            'id', ii.id,
            'invoice_id', ii.invoice_id,
            'item_id', ii.item_id,
            'name', ii.name,
            'quantity', ii.quantity,
            'unit_price', ii.unit_price,
            'discount_percentage', ii.discount_percentage,
            'discount_amount', ii.discount_amount,
            'tax_rate', ii.tax_rate,
            'tax_amount', ii.tax_amount,
            'total_amount', ii.total_amount,
            'created_at', ii.created_at
          ) ORDER BY ii.id
        ) FILTER (WHERE ii.id IS NOT NULL),
        '[]'
      ) as items
    FROM invoices i
    LEFT JOIN parties p ON i.party_id = p.id
    LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
    WHERE i.id = $1 AND i.business_id = $2
    GROUP BY i.id, p.name
  `;

  const invoiceRes = await pool.query(query, [invoiceId, businessId]);

  if (invoiceRes.rowCount === 0) {
    throw new ApiError(404, "Invoice not found");
  }

  const invoice = invoiceRes.rows[0];
  await setCache(cacheKey, invoice, 60);
  res.status(200).json(invoice);
}
