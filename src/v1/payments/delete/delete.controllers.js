import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

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
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
