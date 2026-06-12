import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import { invalidateBusinessCache } from "../../../utils/cacheInvalidation.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function updatePayment(req, res) {
  const { businessId, paymentId } = req.params;
  const {
    party_id,
    invoice_id,
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

    // Lock old payment
    const oldPaymentRes = await client.query(
      "SELECT * FROM payments WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [paymentId, businessId]
    );

    if (oldPaymentRes.rowCount === 0) {
      throw new ApiError(404, "Payment record not found");
    }

    const oldPayment = oldPaymentRes.rows[0];

    // Revert old invoice paid_amount if existed
    if (oldPayment.invoice_id) {
      const oldInvoiceRes = await client.query(
        "SELECT * FROM invoices WHERE id = $1 FOR UPDATE",
        [oldPayment.invoice_id]
      );
      if (oldInvoiceRes.rowCount > 0) {
        const oldInvoice = oldInvoiceRes.rows[0];
        const revertedPaidAmount = Math.max(0, round2(Number(oldInvoice.paid_amount) - Number(oldPayment.amount)));
        let revertedPaymentStatus = "unpaid";
        if (revertedPaidAmount >= Number(oldInvoice.total_amount)) {
          revertedPaymentStatus = "paid";
        } else if (revertedPaidAmount > 0) {
          revertedPaymentStatus = "partially_paid";
        }

        await client.query(
          "UPDATE invoices SET paid_amount = $1, payment_status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
          [revertedPaidAmount, revertedPaymentStatus, oldPayment.invoice_id]
        );
      }
    }

    // Lock old party
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

    // Validate and update new invoice if specified
    const amt = Number(amount);
    if (invoice_id) {
      const newInvoiceRes = await client.query(
        "SELECT * FROM invoices WHERE id = $1 AND business_id = $2 FOR UPDATE",
        [invoice_id, businessId]
      );
      if (newInvoiceRes.rowCount === 0) {
        throw new ApiError(404, "Invoice not found");
      }
      const linkedInvoice = newInvoiceRes.rows[0];

      if (linkedInvoice.party_id !== party_id) {
        throw new ApiError(400, "Invoice does not belong to the selected party");
      }

      if (linkedInvoice.invoice_type === "sale" && payment_type !== "payment_in") {
        throw new ApiError(400, "For sale invoices, payment type must be payment_in");
      }
      if (linkedInvoice.invoice_type === "purchase" && payment_type !== "payment_out") {
        throw new ApiError(400, "For purchase invoices, payment type must be payment_out");
      }
      if (linkedInvoice.invoice_type !== "sale" && linkedInvoice.invoice_type !== "purchase") {
        throw new ApiError(400, "Linked payments are only supported for sale and purchase invoices");
      }

      const currentPaid = Number(linkedInvoice.paid_amount);
      const totalAmt = Number(linkedInvoice.total_amount);
      const remainingUnpaid = round2(totalAmt - currentPaid);
      if (amt > remainingUnpaid) {
        throw new ApiError(400, `Payment amount (${amt}) exceeds the remaining unpaid invoice amount (${remainingUnpaid})`);
      }

      const newPaidAmount = round2(currentPaid + amt);
      let newPaymentStatus = "unpaid";
      if (newPaidAmount >= totalAmt) {
        newPaymentStatus = "paid";
      } else if (newPaidAmount > 0) {
        newPaymentStatus = "partially_paid";
      }

      await client.query(
        "UPDATE invoices SET paid_amount = $1, payment_status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
        [newPaidAmount, newPaymentStatus, invoice_id]
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

    const query = `
      UPDATE payments SET
        party_id = $1,
        invoice_id = $2,
        payment_type = $3,
        reference_number = $4,
        payment_date = $5,
        amount = $6,
        payment_mode = $7,
        description = $8,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9 AND business_id = $10
      RETURNING *
    `;
    const values = [
      party_id,
      invoice_id || null,
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

    // Apply new effect on new party
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
    await invalidateBusinessCache(businessId);
    res.status(200).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
