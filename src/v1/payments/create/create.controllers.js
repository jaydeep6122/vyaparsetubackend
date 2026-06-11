import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function createPayment(req, res) {
  const { businessId } = req.params;
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

    const partyRes = await client.query(
      "SELECT * FROM parties WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [party_id, businessId]
    );

    if (partyRes.rowCount === 0) {
      throw new ApiError(404, "Party not found");
    }

    const party = partyRes.rows[0];
    const amt = Number(amount);

    if (invoice_id) {
      const invoiceRes = await client.query(
        "SELECT * FROM invoices WHERE id = $1 AND business_id = $2 FOR UPDATE",
        [invoice_id, businessId]
      );
      if (invoiceRes.rowCount === 0) {
        throw new ApiError(404, "Invoice not found");
      }
      const linkedInvoice = invoiceRes.rows[0];

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

    const query = `
      INSERT INTO payments (
        business_id, party_id, invoice_id, payment_type, reference_number, 
        payment_date, amount, payment_mode, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    const values = [
      businessId,
      party_id,
      invoice_id || null,
      payment_type,
      reference_number || null,
      payment_date ? new Date(payment_date) : new Date(),
      amt,
      payment_mode,
      description || null,
    ];

    const result = await client.query(query, values);
    const savedPayment = result.rows[0];

    let balanceChange = 0;
    if (payment_type === "payment_in") {
      balanceChange = -amt;
    } else if (payment_type === "payment_out") {
      balanceChange = amt;
    }

    const newPartyBalance = round2(Number(party.current_balance) + balanceChange);

    await client.query(
      "UPDATE parties SET current_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [newPartyBalance, party_id]
    );

    await client.query("COMMIT");
    res.status(201).json(savedPayment);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
