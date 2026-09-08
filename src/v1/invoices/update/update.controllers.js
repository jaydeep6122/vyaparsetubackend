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

export async function updateInvoice(req, res) {
  const { businessId, invoiceId } = req.params;
  let { invoice_number } = req.body;
  const {
    party_id,
    invoice_type,
    chalan_no,
    transport_cost,
    transporter_party_id,
    vehicle_no,
    transport_qty,
    transport_rate,
    transport_paid_amount,
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

    const oldInvoiceRes = await client.query(
      "SELECT * FROM invoices WHERE id = $1 AND business_id = $2 FOR UPDATE",
      [invoiceId, businessId],
    );
    if (oldInvoiceRes.rowCount === 0) {
      throw new ApiError(404, "Invoice not found");
    }
    const oldInvoice = oldInvoiceRes.rows[0];

    if (!invoice_number) {
      if (invoice_type === "purchase") {
        invoice_number =
          oldInvoice.invoice_number ||
          `PUR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      } else {
        throw new ApiError(400, "invoice_number is required");
      }
    }

    if (
      oldInvoice.invoice_number !== invoice_number ||
      oldInvoice.invoice_type !== invoice_type
    ) {
      const dupCheck = await client.query(
        "SELECT id FROM invoices WHERE business_id = $1 AND invoice_type = $2 AND invoice_number = $3 AND id != $4",
        [businessId, invoice_type, invoice_number, invoiceId],
      );
      if (dupCheck.rowCount > 0) {
        throw new ApiError(
          400,
          `Invoice number '${invoice_number}' already exists for type '${invoice_type}'`,
        );
      }
    }

    const oldItemsRes = await client.query(
      "SELECT * FROM invoice_items WHERE invoice_id = $1",
      [invoiceId],
    );
    const oldInvoiceItems = oldItemsRes.rows;

    // The request body is validated as a partial, so anything absent keeps the
    // value already on the row.
    const nextTransporterPartyId =
      transporter_party_id === undefined
        ? oldInvoice.transporter_party_id
        : transporter_party_id || null;
    const nextVehicleNo =
      vehicle_no === undefined ? oldInvoice.vehicle_no : vehicle_no || null;
    const nextTransportQty =
      transport_qty === undefined ? oldInvoice.transport_qty : transport_qty;
    const nextTransportRate =
      transport_rate === undefined ? oldInvoice.transport_rate : transport_rate;

    if (nextTransporterPartyId && invoice_type !== "purchase") {
      throw new ApiError(
        400,
        "A transporter can only be set on a purchase. Remove the transporter before changing the transaction type.",
      );
    }
    if (nextTransporterPartyId && nextTransporterPartyId === party_id) {
      throw new ApiError(
        400,
        "The transporter must be a different party from the supplier",
      );
    }

    // Every party this edit can touch is locked here, in id order, before the
    // item loop - so the invoice -> parties -> items order matches create's and
    // a supplier/transporter pair cannot deadlock against a concurrent write.
    const partyRows = await lockParties(client, businessId, [
      oldInvoice.party_id,
      oldInvoice.transporter_party_id,
      party_id,
      nextTransporterPartyId,
    ]);

    // Reverts are computed from the old row's own columns, which is what lets
    // rows written before transporters existed revert under the old rule.
    const deltas = {};
    const oldLegs = computeLegs({
      total_amount: oldInvoice.total_amount,
      transport_cost: oldInvoice.transport_cost,
      transporter_party_id: oldInvoice.transporter_party_id,
    });
    if (oldInvoice.party_id) {
      addDelta(
        deltas,
        oldInvoice.party_id,
        -goodsSign(oldInvoice.invoice_type) *
          round2(oldLegs.goodsLeg - Number(oldInvoice.paid_amount || 0)),
      );
    }
    if (oldLegs.hasTransportLeg) {
      addDelta(
        deltas,
        oldInvoice.transporter_party_id,
        round2(
          oldLegs.transportLeg - Number(oldInvoice.transport_paid_amount || 0),
        ),
      );
    }

    await client.query("DELETE FROM invoice_items WHERE invoice_id = $1", [
      invoiceId,
    ]);

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

    // Quantity x rate wins whenever either was sent; otherwise transport_cost
    // (sent, or carried over) stands on its own.
    const transportAmt =
      transport_qty !== undefined || transport_rate !== undefined
        ? resolveTransportAmount({
            transport_qty: nextTransportQty,
            transport_rate: nextTransportRate,
            transport_cost,
          })
        : transport_cost === undefined
          ? round2(Number(oldInvoice.transport_cost || 0))
          : round2(Number(transport_cost || 0));

    const calcTotalAmount = round2(calcSubtotal + calcTaxAmount + transportAmt);

    const { hasTransportLeg, transportLeg, goodsLeg } = computeLegs({
      total_amount: calcTotalAmount,
      transport_cost: transportAmt,
      transporter_party_id: nextTransporterPartyId,
    });

    const paidAmt = Number(paid_amount);
    const transportPaidAmt = hasTransportLeg
      ? Number(
          (transport_paid_amount === undefined
            ? oldInvoice.transport_paid_amount
            : transport_paid_amount) || 0,
        )
      : 0;

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

    const totalPaid = round2(paidAmt + transportPaidAmt);
    let payment_status = "unpaid";
    if (totalPaid >= calcTotalAmount) {
      payment_status = "paid";
    } else if (totalPaid > 0) {
      payment_status = "partially_paid";
    }

    const updateInvoiceQuery = `
      UPDATE invoices
      SET
        party_id = $1,
        invoice_number = $2,
        invoice_type = $3,
        chalan_no = $4,
        transport_cost = $5,
        invoice_date = $6,
        due_date = $7,
        delivery_date = $8,
        sub_total = $9,
        tax_amount = $10,
        discount_amount = $11,
        total_amount = $12,
        paid_amount = $13,
        payment_status = $14,
        payment_mode = $15,
        notes = $16,
        transporter_party_id = $17,
        vehicle_no = $18,
        transport_qty = $19,
        transport_rate = $20,
        transport_paid_amount = $21,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $22
      RETURNING *
    `;

    const invoiceValues = [
      party_id || null,
      invoice_number,
      invoice_type,
      chalan_no === undefined ? oldInvoice.chalan_no : chalan_no || null,
      transportAmt,
      invoice_date ? new Date(invoice_date) : oldInvoice.invoice_date,
      due_date ? new Date(due_date) : null,
      delivery_date === undefined
        ? oldInvoice.delivery_date
        : delivery_date
          ? new Date(delivery_date)
          : null,
      round2(calcSubtotal),
      round2(calcTaxAmount),
      round2(calcDiscountAmount),
      calcTotalAmount,
      paidAmt,
      payment_status,
      payment_mode,
      notes || null,
      nextTransporterPartyId,
      nextVehicleNo,
      nextTransportQty === undefined || nextTransportQty === null
        ? null
        : Number(nextTransportQty),
      nextTransportRate === undefined || nextTransportRate === null
        ? null
        : Number(nextTransportRate),
      transportPaidAmt,
      invoiceId,
    ];

    const invoiceResult = await client.query(updateInvoiceQuery, invoiceValues);
    const updatedInvoice = invoiceResult.rows[0];

    for (const item of itemsToInsert) {
      await client.query(
        `INSERT INTO invoice_items (
          invoice_id, item_id, name, quantity, unit_price, 
          discount_percentage, discount_amount, tax_rate, tax_amount, total_amount, hsn_code
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          invoiceId,
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

    if (party_id) {
      addDelta(
        deltas,
        party_id,
        goodsSign(invoice_type) * round2(goodsLeg - paidAmt),
      );
    }
    if (hasTransportLeg) {
      addDelta(
        deltas,
        nextTransporterPartyId,
        -round2(transportLeg - transportPaidAmt),
      );
    }

    // Applied once per party, so a party that is both the old and the new one
    // gets a single net write rather than two read-modify-writes.
    await applyBalanceDeltas(client, partyRows, deltas);

    await client.query("COMMIT");
    res.status(200).json(updatedInvoice);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
