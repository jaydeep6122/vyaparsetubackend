import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import {
  computeLegs,
  resolveTransportAmount,
  goodsSign,
  lockParties,
  addDelta,
  applyBalanceDeltas,
} from "../shared/legs.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function createInvoice(req, res) {
  const { businessId } = req.params;
  let { invoice_number } = req.body;
  const {
    party_id,
    invoice_type,
    chalan_no,
    transport_cost = 0,
    transporter_party_id,
    vehicle_no,
    transport_qty,
    transport_rate,
    transport_paid_amount = 0,
    invoice_date,
    due_date,
    delivery_date,
    discount_amount = 0,
    paid_amount = 0,
    payment_mode,
    notes,
    items = [],
  } = req.body;

  if (invoice_type !== "purchase" && !invoice_number) {
    throw new ApiError(400, "invoice_number is required");
  }
  if (!invoice_type || !payment_mode) {
    throw new ApiError(400, "invoice_type and payment_mode are required");
  }

  if (!invoice_number && invoice_type === "purchase") {
    invoice_number = `PUR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  const validInvoiceTypes = [
    "sale",
    "purchase",
    "sale_return",
    "purchase_return",
  ];
  if (!validInvoiceTypes.includes(invoice_type)) {
    throw new ApiError(400, "Invalid invoice_type");
  }

  if (items.length === 0) {
    throw new ApiError(400, "Invoice must contain at least one item");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const dupCheck = await client.query(
      "SELECT id FROM invoices WHERE business_id = $1 AND invoice_type = $2 AND invoice_number = $3",
      [businessId, invoice_type, invoice_number],
    );
    if (dupCheck.rowCount > 0) {
      throw new ApiError(
        400,
        `Invoice number '${invoice_number}' already exists for this transaction type`,
      );
    }

    if (transporter_party_id && transporter_party_id === party_id) {
      throw new ApiError(
        400,
        "The transporter must be a different party from the supplier",
      );
    }

    // Locked together, in id order, before the item loop - see shared/legs.js.
    const partyRows = await lockParties(client, businessId, [
      party_id,
      transporter_party_id,
    ]);
    const party = party_id ? partyRows.get(party_id) : null;

    let calcSubtotal = 0;
    let calcTaxAmount = 0;
    let calcDiscountAmount = 0;
    const itemsToInsert = [];

    for (const item of items) {
      if (!item.name || !item.quantity || !item.unit_price) {
        throw new ApiError(
          400,
          "Each item must have a name, quantity, and unit_price",
        );
      }

      let dbItem = null;
      if (item.item_id) {
        const itemRes = await client.query(
          "SELECT * FROM items WHERE id = $1 AND business_id = $2 FOR UPDATE",
          [item.item_id, businessId],
        );
        if (itemRes.rowCount === 0) {
          throw new ApiError(404, `Item with ID ${item.item_id} not found`);
        }
        dbItem = itemRes.rows[0];
      }

      const qty = Number(item.quantity);
      const price = Number(item.unit_price);
      const discountPct = Number(item.discount_percentage || 0);
      const taxRate = Number(item.tax_rate || 0);

      const itemSubtotal = qty * price;
      const itemDiscount = round2(itemSubtotal * (discountPct / 100));
      const itemTaxable = itemSubtotal - itemDiscount;
      const itemTax = round2(itemTaxable * (taxRate / 100));
      const itemTotal = round2(itemTaxable + itemTax);

      calcSubtotal += itemTaxable;
      calcTaxAmount += itemTax;
      calcDiscountAmount += itemDiscount;

      itemsToInsert.push({
        item_id: item.item_id || null,
        name: item.name,
        quantity: qty,
        unit_price: price,
        discount_percentage: discountPct,
        discount_amount: itemDiscount,
        tax_rate: taxRate,
        tax_amount: itemTax,
        total_amount: itemTotal,
        hsn_code: item.hsn_code || (dbItem ? dbItem.hsn_code : null),
        dbItem,
      });
    }

    const overallDiscount = Number(discount_amount);
    calcDiscountAmount += overallDiscount;
    calcSubtotal -= overallDiscount;

    const transportAmt = resolveTransportAmount({
      transport_qty,
      transport_rate,
      transport_cost,
    });

    const calcTotalAmount = round2(calcSubtotal + calcTaxAmount + transportAmt);

    const { hasTransportLeg, transportLeg, goodsLeg } = computeLegs({
      total_amount: calcTotalAmount,
      transport_cost: transportAmt,
      transporter_party_id,
    });

    const paidAmt = Number(paid_amount);
    const transportPaidAmt = hasTransportLeg
      ? Number(transport_paid_amount || 0)
      : 0;

    // Each leg is capped against its own obligation. Without a transporter
    // goodsLeg is the whole total, so this is the previous check unchanged.
    if (paidAmt > goodsLeg) {
      throw new ApiError(
        400,
        `Paid amount (${paidAmt}) cannot be greater than total invoice amount (${goodsLeg})`,
      );
    }
    if (transportPaidAmt > transportLeg) {
      throw new ApiError(
        400,
        `Transport paid amount (${transportPaidAmt}) cannot be greater than the transport amount (${transportLeg})`,
      );
    }

    // Status stays whole-bill so the invoice list and dashboard are unaffected.
    const totalPaid = round2(paidAmt + transportPaidAmt);
    let payment_status = "unpaid";
    if (totalPaid >= calcTotalAmount) {
      payment_status = "paid";
    } else if (totalPaid > 0) {
      payment_status = "partially_paid";
    }

    const invoiceQuery = `
      INSERT INTO invoices (
        business_id, party_id, invoice_number, invoice_type, chalan_no, transport_cost, invoice_date, 
        due_date, delivery_date, sub_total, tax_amount, discount_amount, total_amount, 
        paid_amount, payment_status, payment_mode, notes,
        transporter_party_id, vehicle_no, transport_qty, transport_rate, transport_paid_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *
    `;

    const invoiceValues = [
      businessId,
      party_id || null,
      invoice_number,
      invoice_type,
      chalan_no || null,
      transportAmt,
      invoice_date ? new Date(invoice_date) : new Date(),
      due_date ? new Date(due_date) : null,
      delivery_date ? new Date(delivery_date) : null,
      round2(calcSubtotal),
      round2(calcTaxAmount),
      round2(calcDiscountAmount),
      calcTotalAmount,
      paidAmt,
      payment_status,
      payment_mode,
      notes || null,
      transporter_party_id || null,
      vehicle_no || null,
      transport_qty === undefined || transport_qty === null ? null : Number(transport_qty),
      transport_rate === undefined || transport_rate === null ? null : Number(transport_rate),
      transportPaidAmt,
    ];

    const invoiceResult = await client.query(invoiceQuery, invoiceValues);
    const savedInvoice = invoiceResult.rows[0];

    for (const item of itemsToInsert) {
      await client.query(
        `INSERT INTO invoice_items (
          invoice_id, item_id, name, quantity, unit_price, 
          discount_percentage, discount_amount, tax_rate, tax_amount, total_amount, hsn_code
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          savedInvoice.id,
          item.item_id,
          item.name,
          item.quantity,
          item.unit_price,
          item.discount_percentage,
          item.discount_amount,
          item.tax_rate,
          item.tax_amount,
          item.total_amount,
          item.hsn_code || null,
        ],
      );
    }

    const deltas = {};
    if (party) {
      addDelta(
        deltas,
        party_id,
        goodsSign(invoice_type) * round2(goodsLeg - paidAmt),
      );
    }
    if (hasTransportLeg) {
      // Freight is a payable whichever way the goods move.
      addDelta(
        deltas,
        transporter_party_id,
        -round2(transportLeg - transportPaidAmt),
      );
    }
    await applyBalanceDeltas(client, partyRows, deltas);

    await client.query("COMMIT");
    res.status(201).json(savedInvoice);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
