import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function updatePayment(req, res) {
  const { businessId, paymentId } = req.params;
  const {
    party_id,
    payment_type,
    amount,
    payment_mode,
    reference_number,
    payment_date,
    description,
  } = req.body;

  if (!party_id || !payment_type || !amount || !payment_mode) {
    throw new ApiError(400, "party_id, payment_type, amount, and payment_mode are required");
  }

  if (!["payment_in", "payment_out"].includes(payment_type)) {
    throw new ApiError(400, "Invalid payment_type. Must be payment_in or payment_out");
  }

  if (!["cash", "bank", "upi"].includes(payment_mode)) {
    throw new ApiError(400, "Invalid payment_mode. Must be cash, bank, or upi");
  }

  if (Number(amount) <= 0) {
    throw new ApiError(400, "Amount must be a positive number");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock old payment and party
    const oldPaymentRes = await client.query(
      "SELECT * FROM payments WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [paymentId, businessId]
    );

    if (oldPaymentRes.rowCount === 0) {
      throw new ApiError(404, "Payment record not found");
    }

    const oldPayment = oldPaymentRes.rows[0];

    const oldPartyRes = await client.query(
      "SELECT * FROM parties WHERE id = $1 FOR UPDATE",
      [oldPayment.party_id]
    );

    // Revert old party balance
    let oldBalanceRevert = 0;
    if (oldPayment.payment_type === "payment_in") {
      oldBalanceRevert = Number(oldPayment.amount);
    } else if (oldPayment.payment_type === "payment_out") {
      oldBalanceRevert = -Number(oldPayment.amount);
    }

    if (oldPartyRes.rowCount > 0) {
      const oldParty = oldPartyRes.rows[0];
      const revertBalance = round2(Number(oldParty.current_balance) + oldBalanceRevert);
      await client.query(
        "UPDATE parties SET current_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [revertBalance, oldPayment.party_id]
      );
    }

    // Lock new party (may be same or different)
    const newPartyRes = await client.query(
      "SELECT * FROM parties WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [party_id, businessId]
    );
    if (newPartyRes.rowCount === 0) {
      throw new ApiError(404, "Party not found");
    }
    const newParty = newPartyRes.rows[0];
    const amt = Number(amount);

    const query = `
      UPDATE payments SET
        party_id = $1,
        payment_type = $2,
        reference_number = $3,
        payment_date = $4,
        amount = $5,
        payment_mode = $6,
        description = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 AND business_id = $9
      RETURNING *
    `;
    const values = [
      party_id,
      payment_type,
      reference_number || null,
      payment_date ? new Date(payment_date) : new Date(),
      amt,
      payment_mode,
      description || null,
      paymentId,
      businessId,
    ];

    const result = await client.query(query, values);

    // Apply new effect
    let balanceChange = 0;
    if (payment_type === "payment_in") {
      balanceChange = -amt;
    } else if (payment_type === "payment_out") {
      balanceChange = amt;
    }

    const newPartyBalance = round2(Number(newParty.current_balance) + balanceChange);
    await client.query(
      "UPDATE parties SET current_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [newPartyBalance, party_id]
    );

    await client.query("COMMIT");
    res.status(200).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
