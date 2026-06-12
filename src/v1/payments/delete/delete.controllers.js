import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import { invalidateBusinessCache } from "../../../utils/cacheInvalidation.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function deletePayment(req, res) {
  const { businessId, paymentId } = req.params;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paymentRes = await client.query(
      "SELECT * FROM payments WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [paymentId, businessId]
    );

    if (paymentRes.rowCount === 0) {
      throw new ApiError(404, "Payment record not found");
    }

    const payment = paymentRes.rows[0];

    // Revert invoice paid_amount if existed
    if (payment.invoice_id) {
      const invoiceRes = await client.query(
        "SELECT * FROM invoices WHERE id = $1 FOR UPDATE",
        [payment.invoice_id]
      );
      if (invoiceRes.rowCount > 0) {
        const invoice = invoiceRes.rows[0];
        const revertedPaidAmount = Math.max(0, round2(Number(invoice.paid_amount) - Number(payment.amount)));
        let revertedPaymentStatus = "unpaid";
        if (revertedPaidAmount >= Number(invoice.total_amount)) {
          revertedPaymentStatus = "paid";
        } else if (revertedPaidAmount > 0) {
          revertedPaymentStatus = "partially_paid";
        }

        await client.query(
          "UPDATE invoices SET paid_amount = $1, payment_status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
          [revertedPaidAmount, revertedPaymentStatus, payment.invoice_id]
        );
      }
    }

    const partyRes = await client.query(
      "SELECT * FROM parties WHERE id = $1 FOR UPDATE",
      [payment.party_id]
    );

    if (partyRes.rowCount > 0) {
      const party = partyRes.rows[0];
      const amt = Number(payment.amount);

      let balanceRevert = 0;
      if (payment.payment_type === "payment_in") {
        balanceRevert = amt;
      } else if (payment.payment_type === "payment_out") {
        balanceRevert = -amt;
      }

      const newPartyBalance = round2(Number(party.current_balance) + balanceRevert);

      await client.query(
        "UPDATE parties SET current_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [newPartyBalance, payment.party_id]
      );
    }

    await client.query(
      "DELETE FROM payments WHERE id = $1",
      [paymentId]
    );

    await client.query("COMMIT");
    await invalidateBusinessCache(businessId);
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
