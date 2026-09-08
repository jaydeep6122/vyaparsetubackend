import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import {
  computeLegs,
  goodsSign,
  lockParties,
  addDelta,
  applyBalanceDeltas,
} from "../shared/legs.js";

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


    // Both legs are reverted, each from the row's own columns, so an invoice
    // written before transporters existed reverts under the old rule.
    const partyRows = await lockParties(client, businessId, [
      invoice.party_id,
      invoice.transporter_party_id,
    ]);

    const legs = computeLegs({
      total_amount: invoice.total_amount,
      transport_cost: invoice.transport_cost,
      transporter_party_id: invoice.transporter_party_id,
    });

    const deltas = {};
    if (invoice.party_id) {
      addDelta(
        deltas,
        invoice.party_id,
        -goodsSign(invoice.invoice_type) *
          round2(legs.goodsLeg - Number(invoice.paid_amount || 0)),
      );
    }
    if (legs.hasTransportLeg) {
      addDelta(
        deltas,
        invoice.transporter_party_id,
        round2(legs.transportLeg - Number(invoice.transport_paid_amount || 0)),
      );
    }
    await applyBalanceDeltas(client, partyRows, deltas);

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
