import { ApiError } from "../../../utils/ApiError.js";

export const round2 = (num) =>
  Math.round((Number(num) + Number.EPSILON) * 100) / 100;

/**
 * Splits an invoice's total into the goods leg and the transport leg.
 *
 * `total_amount` always means the grand total of the transaction
 * (sub_total + tax_amount + transport_cost). What the transporter changes is
 * only *who owes the remainder*: without a transporter the freight stays on
 * the supplier exactly as it always has, so rows written before this feature
 * existed keep the semantics their current_balance was accumulated under.
 * That is why there is no backfill. Never compute a leg by hand - every caller
 * goes through here so the two rules cannot drift apart.
 */
export function computeLegs({
  total_amount,
  transport_cost,
  transporter_party_id,
}) {
  const total = round2(total_amount || 0);
  const transport = Number(transport_cost || 0);
  const hasTransportLeg = Boolean(transporter_party_id) && transport > 0;
  const transportLeg = hasTransportLeg ? round2(transport) : 0;

  return { hasTransportLeg, transportLeg, goodsLeg: round2(total - transportLeg) };
}

/**
 * Transport is billed as quantity x per-unit rate; `transport_cost` is only a
 * cache of that product. Recompute it server-side whenever both inputs are
 * present so a client cannot post a total that disagrees with its own inputs.
 */
export function resolveTransportAmount({
  transport_qty,
  transport_rate,
  transport_cost,
}) {
  if (transport_qty !== undefined && transport_qty !== null &&
      transport_rate !== undefined && transport_rate !== null) {
    return round2(Number(transport_qty) * Number(transport_rate));
  }
  return round2(Number(transport_cost || 0));
}

/** Direction an unpaid goods balance moves the supplier's/customer's balance. */
export function goodsSign(invoiceType) {
  switch (invoiceType) {
    case "sale":
      return 1;
    case "sale_return":
      return -1;
    case "purchase":
      return -1;
    case "purchase_return":
      return 1;
    default:
      return 0;
  }
}

/**
 * Locks every party a write touches, in ascending id order.
 *
 * Two concurrent invoices sharing a supplier/transporter pair would deadlock if
 * each locked them in its own order, so the order is fixed here. The locks are
 * taken as N sequential statements rather than one `id = ANY(...) ORDER BY id`
 * because Postgres does not guarantee lock acquisition follows ORDER BY under
 * every plan. Callers must invoke this before locking invoice_items to keep the
 * invoice -> parties -> items order consistent across all three controllers.
 */
export async function lockParties(client, businessId, ids) {
  const unique = [...new Set(ids.filter(Boolean))].sort();
  const rows = new Map();

  for (const id of unique) {
    const res = await client.query(
      "SELECT * FROM parties WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [id, businessId],
    );
    if (res.rowCount === 0) {
      throw new ApiError(404, "Selected party not found for this business");
    }
    rows.set(id, res.rows[0]);
  }

  return rows;
}

/** Accumulates a balance change so each party is written exactly once. */
export function addDelta(deltas, partyId, amount) {
  if (!partyId || !amount) return deltas;
  deltas[partyId] = round2((deltas[partyId] || 0) + amount);
  return deltas;
}

export async function applyBalanceDeltas(client, partyRows, deltas) {
  for (const [id, delta] of Object.entries(deltas)) {
    if (!delta) continue;
    const party = partyRows.get(id);
    if (!party) continue;

    await client.query(
      "UPDATE parties SET current_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [round2(Number(party.current_balance) + delta), id],
    );
  }
}

/**
 * Works out which leg of a linked invoice a payment settles.
 *
 * A payment belongs to the transport leg iff the payer is the invoice's
 * transporter. That inference is unambiguous because the validators refuse an
 * invoice whose transporter is also its supplier.
 *
 * `column` is one of two hard-coded identifiers, never caller input - callers
 * interpolate it into the UPDATE statement.
 */
export function resolveLinkedLeg(invoice, partyId) {
  const isTransportLeg =
    Boolean(invoice.transporter_party_id) &&
    invoice.transporter_party_id === partyId;
  const legs = computeLegs(invoice);

  return {
    isTransportLeg,
    legTotal: isTransportLeg ? legs.transportLeg : legs.goodsLeg,
    legPaid: round2(
      (isTransportLeg ? invoice.transport_paid_amount : invoice.paid_amount) || 0,
    ),
    column: isTransportLeg ? "transport_paid_amount" : "paid_amount",
  };
}

/** Whole-bill payment status, summing both legs against the grand total. */
export function paymentStatusFor(invoice, { paidAmount, transportPaidAmount }) {
  const total = round2(invoice.total_amount);
  const paid = round2(Number(paidAmount || 0) + Number(transportPaidAmount || 0));

  if (paid >= total) return "paid";
  if (paid > 0) return "partially_paid";
  return "unpaid";
}

/** The paid columns after `legPaid` is written to `leg`'s side of the bill. */
export function legPaidColumns(invoice, leg, legPaid) {
  return leg.isTransportLeg
    ? { paidAmount: invoice.paid_amount, transportPaidAmount: legPaid }
    : { paidAmount: legPaid, transportPaidAmount: invoice.transport_paid_amount };
}
