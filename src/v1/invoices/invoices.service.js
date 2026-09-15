import pool from "../../db/db.js";
import { Filters, insertRows, likePattern, pageResult, setClause } from "../../db/sql.js";
import { withTransaction } from "../../db/transaction.js";
import { audit } from "../../services/audit.js";
import { computeInvoice, supplyTypeFor } from "../../services/gst.js";
import { invoiceDocType, nextDocumentNumber } from "../../services/numbering.js";
import { postInvoice } from "../../services/posting.js";
import { ApiError } from "../../utils/ApiError.js";
import { addDays, today } from "../../utils/fy.js";
import { dec, money } from "../../utils/money.js";
import { recordPayment } from "../payments/payments.service.js";

const PAYMENT_DIRECTION = { sale: "in", purchase_return: "in", purchase: "out", sale_return: "out" };
const PARTY_TYPES = {
  sale: ["customer", "both"],
  sale_return: ["customer", "both"],
  purchase: ["supplier", "both"],
  purchase_return: ["supplier", "both"],
};
const RETURN_OF = { sale_return: "sale", purchase_return: "purchase" };

// Copied from the request as given; anything not sent is stored as NULL.
const PASSTHROUGH_FIELDS = [
  "due_date",
  "supplier_invoice_number",
  "supplier_invoice_date",
  "original_invoice_id",
  "vehicle_no",
  "driver_name",
  "driver_phone",
  "transport_mode",
  "lr_no",
  "lr_date",
  "eway_bill_no",
  "eway_bill_date",
  "chalan_no",
  "delivery_date",
  "dispatch_from",
  "ship_to",
  "notes",
  "terms",
];

const HEADER_COLUMNS = [
  ...PASSTHROUGH_FIELDS,
  "invoice_type",
  "tax_mode",
  "status",
  "invoice_number",
  "invoice_date",
  "party_id",
  "party_name",
  "party_gstin",
  "party_state_code",
  "billing_address",
  "shipping_address",
  "place_of_supply",
  "supply_type",
  "is_reverse_charge",
  "price_includes_tax",
  "taxable_total",
  "discount_total",
  "cgst_total",
  "sgst_total",
  "igst_total",
  "cess_total",
  "charges_total",
  "round_off",
  "total_amount",
];

const LINE_COLUMNS = [
  "business_id",
  "invoice_id",
  "tax_mode",
  "line_no",
  "item_id",
  "description",
  "hsn_sac",
  "quantity",
  "unit_code",
  "unit_price",
  "discount_pct",
  "discount_amount",
  "taxable_value",
  "tax_rate",
  "cess_rate",
  "cgst_amount",
  "sgst_amount",
  "igst_amount",
  "cess_amount",
  "line_total",
];

const CHARGE_COLUMNS = [
  "charge_type",
  "description",
  "bill_to",
  "payee_party_id",
  "vehicle_no",
  "qty",
  "rate",
  "amount",
  "tax_rate",
  "tax_amount",
];

const label = (type) => type.replace("_", " ");

/**
 * Validates an invoice request and prices it. `existing` is the stored
 * invoice when editing. Returns the header row, lines and charges ready to
 * write; totals are always computed here, never taken from the client.
 */
async function prepareInvoice(client, ctx, data, existing) {
  const { business } = ctx;
  const invoiceType = data.invoice_type;
  const taxMode =
    data.tax_mode ?? existing?.tax_mode ?? (business.gst_registration_type === "regular" ? "gst" : "non_gst");

  if (existing && (invoiceType !== existing.invoice_type || taxMode !== existing.tax_mode)) {
    throw new ApiError(400, "invoice_type and tax_mode cannot be changed; cancel it and create a new invoice");
  }
  if (taxMode === "gst" && business.gst_registration_type !== "regular") {
    throw new ApiError(400, "Only a regular GST-registered business can issue GST invoices; use tax_mode non_gst");
  }
  if (data.supplier_invoice_number && invoiceType !== "purchase") {
    throw new ApiError(400, "supplier_invoice_number is only for purchases");
  }

  const invoiceDate = data.invoice_date ?? existing?.invoice_date ?? today();

  let party = null;
  if (data.party_id) {
    ({
      rows: [party],
    } = await client.query("SELECT * FROM parties WHERE id = $1 AND business_id = $2", [data.party_id, business.id]));
    if (!party) throw new ApiError(400, "Party not found");
    if (party.archived_at && party.id !== existing?.party_id) throw new ApiError(400, "Party is archived");
    if (!PARTY_TYPES[invoiceType].includes(party.party_type)) {
      throw new ApiError(400, `A ${party.party_type} cannot be the party on a ${label(invoiceType)}`);
    }
  } else if (invoiceType !== "sale") {
    throw new ApiError(400, "party_id is required for purchases and returns");
  }

  if (data.original_invoice_id) {
    if (!RETURN_OF[invoiceType]) throw new ApiError(400, "original_invoice_id is only for returns");
    const {
      rows: [original],
    } = await client.query("SELECT invoice_type, party_id, status FROM invoices WHERE id = $1 AND business_id = $2", [
      data.original_invoice_id,
      business.id,
    ]);
    if (!original || original.invoice_type !== RETURN_OF[invoiceType] || original.status !== "final") {
      throw new ApiError(400, `original_invoice_id must be a final ${RETURN_OF[invoiceType]} invoice`);
    }
    if (original.party_id !== party.id) throw new ApiError(400, "The original invoice belongs to a different party");
  }

  // Lines: fill in item defaults (name, HSN, unit, price, GST rate).
  const itemIds = [...new Set(data.lines.map((line) => line.item_id).filter(Boolean))];
  const { rows: items } = itemIds.length
    ? await client.query(
        `SELECT i.*, t.rate AS default_tax_rate, t.cess_rate AS default_cess_rate
         FROM items i LEFT JOIN tax_rates t ON t.id = i.tax_rate_id
         WHERE i.business_id = $1 AND i.id = ANY($2::uuid[])`,
        [business.id, itemIds],
      )
    : { rows: [] };
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const priceField = invoiceType === "sale" || invoiceType === "sale_return" ? "sale_price" : "purchase_price";

  const lines = data.lines.map((line, index) => {
    const item = line.item_id ? itemsById.get(line.item_id) : null;
    if (line.item_id && !item) throw new ApiError(400, `Line ${index + 1}: item not found`);
    if (item?.archived_at && !existing) throw new ApiError(400, `Line ${index + 1}: item is archived`);

    const unitPrice = line.unit_price ?? item?.[priceField];
    if (unitPrice == null) {
      throw new ApiError(400, `Line ${index + 1}: unit_price is required because the item has no ${priceField}`);
    }
    return {
      ...line,
      description: line.description ?? item.name,
      hsn_sac: line.hsn_sac ?? item?.hsn_sac ?? null,
      unit_code: line.unit_code ?? item?.unit_code ?? null,
      unit_price: unitPrice,
      tax_rate: line.tax_rate ?? item?.default_tax_rate ?? "0",
      cess_rate: line.cess_rate ?? item?.default_cess_rate ?? "0",
    };
  });

  const charges = (data.charges ?? []).map((charge) => ({
    ...charge,
    bill_to: charge.bill_to ?? (charge.payee_party_id ? "payee_only" : "invoice_party"),
  }));
  const payeeIds = [...new Set(charges.map((charge) => charge.payee_party_id).filter(Boolean))];
  if (payeeIds.length) {
    const { rowCount } = await client.query(
      "SELECT 1 FROM parties WHERE business_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL",
      [business.id, payeeIds],
    );
    if (rowCount !== payeeIds.length) throw new ApiError(400, "A charge payee was not found or is archived");
  }
  for (const charge of charges) {
    if (charge.bill_to === "payee_only" && party && charge.payee_party_id === party.id) {
      throw new ApiError(400, "A payee_only charge must be owed to someone other than the invoice party");
    }
  }

  const placeOfSupply = taxMode === "gst" ? (data.place_of_supply ?? party?.state_code ?? business.state_code) : null;
  const supplyType = taxMode === "gst" ? supplyTypeFor(business.state_code, placeOfSupply) : null;

  const priced = computeInvoice({
    lines,
    charges,
    taxMode,
    supplyType,
    priceIncludesTax: data.price_includes_tax ?? false,
    roundOff: business.settings?.round_off_invoices !== false,
  });

  const header = Object.fromEntries(PASSTHROUGH_FIELDS.map((field) => [field, data[field] ?? null]));
  if (data.due_date === undefined && party?.credit_days != null && invoiceType === "sale") {
    header.due_date = addDays(invoiceDate, party.credit_days);
  }
  Object.assign(header, priced.totals, {
    invoice_type: invoiceType,
    tax_mode: taxMode,
    status: data.status ?? existing?.status ?? "final",
    invoice_date: invoiceDate,
    party_id: party?.id ?? null,
    party_name: party?.name ?? data.party_name ?? "Cash sale",
    party_gstin: party?.gstin ?? null,
    party_state_code: party?.state_code ?? null,
    billing_address: data.billing_address ?? party?.billing_address ?? null,
    shipping_address: data.shipping_address ?? party?.shipping_address ?? null,
    place_of_supply: placeOfSupply,
    supply_type: supplyType,
    is_reverse_charge: taxMode === "gst" ? (data.is_reverse_charge ?? false) : false,
    price_includes_tax: data.price_includes_tax ?? false,
  });

  return { header, lines: priced.lines, charges: priced.charges };
}

async function writeLines(client, businessId, invoiceId, taxMode, lines) {
  await insertRows(
    client,
    "invoice_lines",
    LINE_COLUMNS,
    lines.map((line) => ({ ...line, business_id: businessId, invoice_id: invoiceId, tax_mode: taxMode })),
  );
}

export async function getInvoice(db, businessId, invoiceId) {
  const {
    rows: [invoice],
  } = await db.query("SELECT * FROM invoices WHERE id = $1 AND business_id = $2", [invoiceId, businessId]);
  if (!invoice) throw new ApiError(404, "Invoice not found");

  const { rows: lines } = await db.query("SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY line_no", [
    invoiceId,
  ]);
  const { rows: charges } = await db.query(
    `SELECT c.*, p.name AS payee_name,
            (c.amount + c.tax_amount - c.amount_settled)::numeric(15,2) AS outstanding
     FROM invoice_charges c LEFT JOIN parties p ON p.id = c.payee_party_id
     WHERE c.invoice_id = $1
     ORDER BY c.charge_type, c.id`,
    [invoiceId],
  );
  const { rows: payments } = await db.query(
    `SELECT pa.id AS allocation_id, pa.amount, pa.invoice_charge_id,
            p.id AS payment_id, p.payment_type, p.payment_number, p.payment_date, p.mode
     FROM payment_allocations pa
     JOIN payments p ON p.id = pa.payment_id
     WHERE pa.invoice_id = $1
        OR pa.invoice_charge_id IN (SELECT id FROM invoice_charges WHERE invoice_id = $1)
     ORDER BY p.payment_date, p.payment_number`,
    [invoiceId],
  );

  return {
    ...invoice,
    outstanding: money(dec(invoice.total_amount).minus(invoice.amount_settled)),
    lines,
    charges,
    payments,
  };
}

export async function createInvoice(ctx, data) {
  return withTransaction(async (client) => {
    const { header, lines, charges } = await prepareInvoice(client, ctx, data, null);
    const paysNow = Boolean(data.payment) || charges.some((charge) => charge.paid_now);

    if (header.status === "draft" && paysNow) throw new ApiError(400, "A draft invoice cannot take payments");
    if (!header.party_id && !(data.payment && dec(data.payment.amount).eq(header.total_amount))) {
      throw new ApiError(
        400,
        `A sale without a party must be paid in full (${header.total_amount}) right away; pick a party for credit sales`,
      );
    }

    header.invoice_number =
      data.invoice_number ??
      (await nextDocumentNumber(
        client,
        ctx.business,
        invoiceDocType(header.invoice_type, header.tax_mode),
        header.invoice_date,
      ));

    const [{ id: invoiceId }] = await insertRows(
      client,
      "invoices",
      ["business_id", "created_by", ...HEADER_COLUMNS],
      [{ ...header, business_id: ctx.business.id, created_by: ctx.user.id }],
      "id",
    );
    await writeLines(client, ctx.business.id, invoiceId, header.tax_mode, lines);
    const savedCharges = await insertRows(
      client,
      "invoice_charges",
      ["business_id", "invoice_id", "tax_mode", ...CHARGE_COLUMNS],
      charges.map((charge) => ({
        ...charge,
        business_id: ctx.business.id,
        invoice_id: invoiceId,
        tax_mode: header.tax_mode,
      })),
      "id",
    );
    await postInvoice(client, invoiceId);

    if (data.payment) {
      await recordPayment(client, ctx, {
        ...data.payment,
        payment_type: PAYMENT_DIRECTION[header.invoice_type],
        payment_date: header.invoice_date,
        party_id: header.party_id,
        allocations: [{ invoice_id: invoiceId, amount: data.payment.amount }],
      });
    }
    for (const [index, charge] of charges.entries()) {
      if (!charge.paid_now) continue;
      await recordPayment(client, ctx, {
        ...charge.paid_now,
        payment_type: "out",
        payment_date: header.invoice_date,
        party_id: charge.payee_party_id,
        allocations: [{ invoice_charge_id: savedCharges[index].id, amount: charge.paid_now.amount }],
      });
    }

    const invoice = await getInvoice(client, ctx.business.id, invoiceId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "create",
      entityType: "invoice",
      entityId: invoiceId,
      after: invoice,
    });
    return invoice;
  });
}

async function lockInvoice(client, businessId, invoiceId) {
  const {
    rows: [invoice],
  } = await client.query("SELECT * FROM invoices WHERE id = $1 AND business_id = $2 FOR UPDATE", [
    invoiceId,
    businessId,
  ]);
  if (!invoice) throw new ApiError(404, "Invoice not found");
  if (invoice.status === "cancelled") throw new ApiError(400, "This invoice is cancelled");
  return invoice;
}

export async function updateInvoice(ctx, invoiceId, data) {
  return withTransaction(async (client) => {
    const existing = await lockInvoice(client, ctx.business.id, invoiceId);
    const before = await getInvoice(client, ctx.business.id, invoiceId);

    if (existing.status === "final" && data.status === "draft") {
      throw new ApiError(400, "A final invoice cannot go back to draft");
    }
    const { header, lines, charges } = await prepareInvoice(client, ctx, data, existing);
    if (charges.some((charge) => charge.paid_now)) {
      throw new ApiError(400, "paid_now is only available when creating an invoice; record a payment instead");
    }

    const settled = dec(existing.amount_settled);
    if (settled.gt(0) && header.party_id !== existing.party_id) {
      throw new ApiError(400, "Cancel the payments against this invoice before changing its party");
    }
    if (settled.gt(header.total_amount)) {
      throw new ApiError(
        400,
        `The new total ${header.total_amount} is less than the ${money(settled)} already paid; cancel payments first`,
      );
    }
    header.invoice_number = data.invoice_number ?? existing.invoice_number;

    // Charges keep their ids so payments made against them stay linked.
    const { rows: oldCharges } = await client.query(
      "SELECT id, payee_party_id, amount_settled FROM invoice_charges WHERE invoice_id = $1 FOR UPDATE",
      [invoiceId],
    );
    const oldById = new Map(oldCharges.map((charge) => [charge.id, charge]));
    const keptIds = new Set(charges.map((charge) => charge.id).filter(Boolean));

    for (const old of oldCharges) {
      if (keptIds.has(old.id)) continue;
      if (dec(old.amount_settled).gt(0)) throw new ApiError(400, "A charge that has been paid cannot be removed");
      await client.query("DELETE FROM invoice_charges WHERE id = $1", [old.id]);
    }
    for (const charge of charges) {
      if (!charge.id) {
        await insertRows(client, "invoice_charges", ["business_id", "invoice_id", "tax_mode", ...CHARGE_COLUMNS], [
          { ...charge, business_id: ctx.business.id, invoice_id: invoiceId, tax_mode: header.tax_mode },
        ]);
        continue;
      }
      const old = oldById.get(charge.id);
      if (!old) throw new ApiError(400, "A charge id does not belong to this invoice");
      if (dec(old.amount_settled).gt(0) && old.payee_party_id !== charge.payee_party_id) {
        throw new ApiError(400, "The payee of a charge that has been paid cannot be changed");
      }
      if (dec(old.amount_settled).gt(dec(charge.amount).plus(charge.tax_amount))) {
        throw new ApiError(400, "A charge cannot be reduced below what has already been paid on it");
      }
      const set = setClause(charge, CHARGE_COLUMNS);
      await client.query(`UPDATE invoice_charges SET ${set.sql} WHERE id = $${set.keys.length + 1}`, [
        ...set.values,
        charge.id,
      ]);
    }

    const set = setClause(header, HEADER_COLUMNS);
    await client.query(`UPDATE invoices SET ${set.sql} WHERE id = $${set.keys.length + 1}`, [...set.values, invoiceId]);
    await client.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invoiceId]);
    await writeLines(client, ctx.business.id, invoiceId, header.tax_mode, lines);
    await postInvoice(client, invoiceId);

    const after = await getInvoice(client, ctx.business.id, invoiceId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "update",
      entityType: "invoice",
      entityId: invoiceId,
      before,
      after,
    });
    return after;
  });
}

/** Final invoices are cancelled, never deleted, so their numbers stay accounted for. */
export async function cancelInvoice(ctx, invoiceId, reason) {
  return withTransaction(async (client) => {
    const invoice = await lockInvoice(client, ctx.business.id, invoiceId);
    const { rows: paidCharges } = await client.query(
      "SELECT 1 FROM invoice_charges WHERE invoice_id = $1 AND amount_settled > 0",
      [invoiceId],
    );
    if (dec(invoice.amount_settled).gt(0) || paidCharges.length > 0) {
      throw new ApiError(409, "Cancel the payments against this invoice first");
    }

    await client.query(
      "UPDATE invoices SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2 WHERE id = $1",
      [invoiceId, reason ?? null],
    );
    await postInvoice(client, invoiceId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "cancel",
      entityType: "invoice",
      entityId: invoiceId,
      after: { reason },
    });
    return getInvoice(client, ctx.business.id, invoiceId);
  });
}

export async function deleteDraft(ctx, invoiceId) {
  await withTransaction(async (client) => {
    const invoice = await lockInvoice(client, ctx.business.id, invoiceId);
    if (invoice.status !== "draft") {
      throw new ApiError(400, "Only draft invoices can be deleted; cancel a final invoice instead");
    }
    await client.query("DELETE FROM invoices WHERE id = $1", [invoiceId]);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "delete",
      entityType: "invoice",
      entityId: invoiceId,
      before: invoice,
    });
  });
}

export async function listInvoices(ctx, query) {
  const filters = new Filters().add("i.business_id = ?", ctx.business.id);
  filters.addIf(query.invoice_type, "i.invoice_type = ?", query.invoice_type);
  filters.addIf(query.tax_mode, "i.tax_mode = ?", query.tax_mode);
  filters.addIf(query.status, "i.status = ?", query.status);
  filters.addIf(query.payment_status, "i.payment_status = ?", query.payment_status);
  filters.addIf(query.party_id, "i.party_id = ?", query.party_id);
  filters.addIf(query.from, "i.invoice_date >= ?", query.from);
  filters.addIf(query.to, "i.invoice_date <= ?", query.to);
  filters.addIf(
    query.overdue,
    "i.status = 'final' AND i.amount_settled < i.total_amount AND i.due_date < ?",
    today(),
  );
  filters.addIf(
    query.search,
    "(i.invoice_number ILIKE ? OR i.party_name ILIKE ? OR i.vehicle_no ILIKE ?)",
    query.search && likePattern(query.search),
  );

  const { rows } = await pool.query(
    `SELECT i.id, i.invoice_type, i.tax_mode, i.status, i.invoice_number, i.invoice_date, i.due_date,
            i.party_id, i.party_name, i.total_amount, i.amount_settled, i.payment_status,
            (i.total_amount - i.amount_settled)::numeric(15,2) AS outstanding,
            i.vehicle_no, i.created_at,
            COUNT(*) OVER () AS total_count
     FROM invoices i
     ${filters.where}
     ORDER BY i.invoice_date DESC, i.created_at DESC
     LIMIT ${filters.param(query.limit)} OFFSET ${filters.param(query.offset)}`,
    filters.values,
  );
  return pageResult(rows, query);
}
