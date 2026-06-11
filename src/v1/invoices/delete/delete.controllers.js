import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function deleteInvoice(req, res) {
  const { businessId, invoiceId } = req.params;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const invoiceRes = await client.query(
      "SELECT * FROM invoices WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [invoiceId, businessId]
    );

    if (invoiceRes.rowCount === 0) {
      throw new ApiError(404, "Invoice not found");
    }

    const invoice = invoiceRes.rows[0];


    if (invoice.party_id) {
      const partyRes = await client.query(
        "SELECT * FROM parties WHERE id = $1 FOR UPDATE",
        [invoice.party_id]
      );

      if (partyRes.rowCount > 0) {
        const party = partyRes.rows[0];
        const unpaidAmount = Number(invoice.total_amount) - Number(invoice.paid_amount);
        let balanceRevert = 0;

        if (invoice.invoice_type === "sale") {
          balanceRevert = -unpaidAmount;
        } else if (invoice.invoice_type === "sale_return") {
          balanceRevert = unpaidAmount;
        } else if (invoice.invoice_type === "purchase") {
          balanceRevert = unpaidAmount;
        } else if (invoice.invoice_type === "purchase_return") {
          balanceRevert = -unpaidAmount;
        }

        const newPartyBalance = round2(Number(party.current_balance) + balanceRevert);

        await client.query(
          "UPDATE parties SET current_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
          [newPartyBalance, invoice.party_id]
        );
      }
    }

    await client.query(
      "DELETE FROM invoices WHERE id = $1",
      [invoiceId]
    );

    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
