import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function listInvoices(req, res) {
  const { businessId } = req.params;
  const { invoice_type, party_id, from_date, to_date, search } = req.query;

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
  res.status(200).json(result.rows);
}

export async function getInvoiceById(req, res) {
  const { businessId, invoiceId } = req.params;

  const invoiceRes = await pool.query(
    `SELECT i.*, p.name as party_name 
     FROM invoices i
     LEFT JOIN parties p ON i.party_id = p.id
     WHERE i.id = $1 AND i.business_id = $2`,
    [invoiceId, businessId]
  );

  if (invoiceRes.rowCount === 0) {
    throw new ApiError(404, "Invoice not found");
  }

  const invoice = invoiceRes.rows[0];

  const itemsRes = await pool.query(
    "SELECT * FROM invoice_items WHERE invoice_id = $1",
    [invoiceId]
  );

  invoice.items = itemsRes.rows;

  res.status(200).json(invoice);
}
