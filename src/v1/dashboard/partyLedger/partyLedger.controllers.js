import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import { computeLegs } from "../../invoices/shared/legs.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function getPartyLedgerReport(req, res) {
  const { businessId, partyId } = req.params;

  const partyCheck = await pool.query(
    "SELECT * FROM parties WHERE id = $1 AND business_id = $2",
    [partyId, businessId]
  );

  if (partyCheck.rowCount === 0) {
    throw new ApiError(404, "Party not found");
  }

  const party = partyCheck.rows[0];

  const invoicesRes = await pool.query(
    `SELECT id, invoice_number as ref_no, invoice_type as type, invoice_date as date, 
            total_amount, paid_amount,
            transporter_party_id, transport_cost, transport_paid_amount
     FROM invoices
     WHERE business_id = $1 AND party_id = $2`,
    [businessId, partyId]
  );

  // Freight on an invoice that names a transporter is owed by that transporter,
  // not by this party, so it is billed on their own ledger instead.
  const transportRes = await pool.query(
    `SELECT id, invoice_number as ref_no, invoice_date as date,
            transport_cost, transport_paid_amount
     FROM invoices
     WHERE business_id = $1 AND transporter_party_id = $2 AND transport_cost > 0`,
    [businessId, partyId]
  );

  const paymentsRes = await pool.query(
    `SELECT id, reference_number as ref_no, payment_type as type, payment_date as date, 
            amount as total_amount, amount as paid_amount
     FROM payments
     WHERE business_id = $1 AND party_id = $2`,
    [businessId, partyId]
  );

  const ledger = [];

  invoicesRes.rows.forEach((row) => {
    let balance_effect = 0;
    // This party owes the goods leg only; see invoices/shared/legs.js.
    const { goodsLeg } = computeLegs(row);
    const unpaid = round2(goodsLeg - Number(row.paid_amount));

    if (row.type === "sale") {
      balance_effect = unpaid;
    } else if (row.type === "sale_return") {
      balance_effect = -unpaid;
    } else if (row.type === "purchase") {
      balance_effect = -unpaid;
    } else if (row.type === "purchase_return") {
      balance_effect = unpaid;
    }

    ledger.push({
      id: row.id,
      date: row.date,
      type: row.type,
      ref_no: row.ref_no,
      total_amount: round2(goodsLeg),
      paid_amount: Number(row.paid_amount),
      balance_effect: round2(balance_effect),
    });
  });

  transportRes.rows.forEach((row) => {
    const transportTotal = Number(row.transport_cost);
    const transportPaid = Number(row.transport_paid_amount || 0);

    ledger.push({
      id: row.id,
      date: row.date,
      type: "transport",
      // Suffixed because the client renders ref_no verbatim, and this party may
      // also appear on the same invoice number as its supplier.
      ref_no: `${row.ref_no} (T)`,
      total_amount: transportTotal,
      paid_amount: transportPaid,
      balance_effect: round2(-(transportTotal - transportPaid)),
    });
  });

  paymentsRes.rows.forEach((row) => {
    let balance_effect = 0;
    if (row.type === "payment_in") {
      balance_effect = -Number(row.total_amount);
    } else if (row.type === "payment_out") {
      balance_effect = Number(row.total_amount);
    }

    ledger.push({
      id: row.id,
      date: row.date,
      type: row.type,
      ref_no: row.ref_no || "PAY-REF",
      total_amount: Number(row.total_amount),
      paid_amount: Number(row.paid_amount),
      balance_effect: round2(balance_effect),
    });
  });

  ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

  let runningBalance =
    party.opening_balance_type === "receive"
      ? Number(party.opening_balance)
      : -Number(party.opening_balance);

  const ledgerWithRunningBalance = ledger.map((entry) => {
    runningBalance += entry.balance_effect;
    return {
      ...entry,
      running_balance: round2(runningBalance),
    };
  });

  res.status(200).json({
    party: {
      id: party.id,
      name: party.name,
      opening_balance: Number(party.opening_balance),
      opening_balance_type: party.opening_balance_type,
      current_balance: Number(party.current_balance),
    },
    ledger: ledgerWithRunningBalance,
  });
}
