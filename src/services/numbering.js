import { financialYear } from "../utils/fy.js";

const DEFAULT_PREFIX = {
  sale: "INV",
  sale_non_gst: "BILL",
  purchase: "PUR",
  purchase_non_gst: "PB",
  sale_return: "CN",
  purchase_return: "DN",
  payment_in: "REC",
  payment_out: "PAY",
  expense: "EXP",
};

/** GST and non-GST bills are numbered in separate series. */
export const invoiceDocType = (invoiceType, taxMode) =>
  taxMode === "non_gst" && (invoiceType === "sale" || invoiceType === "purchase")
    ? `${invoiceType}_non_gst`
    : invoiceType;

/**
 * Takes the next number of a series inside the caller's transaction. The row
 * lock makes concurrent documents wait, and a rolled-back document gives its
 * number back, so numbers stay unique and gap-free. A series is created on
 * first use for each financial year, e.g. 'INV/26-27/1'.
 */
export async function nextDocumentNumber(client, business, docType, date) {
  const fy = financialYear(date, business.fy_start_month);

  await client.query(
    `INSERT INTO document_series (business_id, doc_type, financial_year, prefix)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (business_id, doc_type, financial_year) DO NOTHING`,
    [business.id, docType, fy, `${DEFAULT_PREFIX[docType]}/${fy.slice(2)}/`],
  );

  const {
    rows: [series],
  } = await client.query(
    `UPDATE document_series SET next_number = next_number + 1
     WHERE business_id = $1 AND doc_type = $2 AND financial_year = $3
     RETURNING prefix, next_number - 1 AS number, padding`,
    [business.id, docType, fy],
  );

  return `${series.prefix}${String(series.number).padStart(series.padding, "0")}`;
}
