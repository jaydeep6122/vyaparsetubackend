import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";
import { invalidateBusinessCache } from "../../../utils/cacheInvalidation.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function updateInvoice(req, res) {
  const { businessId, invoiceId } = req.params;
  const {
    party_id,
    invoice_number,
    invoice_type,
    chalan_no,
    transport_cost,
    invoice_date,
    due_date,
    discount_amount = 0,
    paid_amount = 0,
    payment_mode,
    notes,
    items = [],
  } = req.body;

  if (!invoice_number || !invoice_type || !payment_mode) {
    throw new ApiError(400, "invoice_number, invoice_type, and payment_mode are required");
  }

  const validInvoiceTypes = ["sale", "purchase", "sale_return", "purchase_return"];
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
      [invoiceId, businessId]
    );
    if (oldInvoiceRes.rowCount === 0) {
      throw new ApiError(404, "Invoice not found");
    }
    const oldInvoice = oldInvoiceRes.rows[0];

    if (oldInvoice.invoice_number !== invoice_number || oldInvoice.invoice_type !== invoice_type) {
      const dupCheck = await client.query(
        "SELECT id FROM invoices WHERE business_id = $1 AND invoice_type = $2 AND invoice_number = $3 AND id != $4",
        [businessId, invoice_type, invoice_number, invoiceId]
      );
      if (dupCheck.rowCount > 0) {
        throw new ApiError(400, `Invoice number '${invoice_number}' already exists for type '${invoice_type}'`);
      }
    }

    const oldItemsRes = await client.query(
      "SELECT * FROM invoice_items WHERE invoice_id = $1",
      [invoiceId]
    );
    const oldInvoiceItems = oldItemsRes.rows;

    if (oldInvoice.party_id) {
      const partyRes = await client.query(
        "SELECT * FROM parties WHERE id = $1 FOR UPDATE",
        [oldInvoice.party_id]
      );
      if (partyRes.rowCount > 0) {
        const party = partyRes.rows[0];
        const oldUnpaidAmount = Number(oldInvoice.total_amount) - Number(oldInvoice.paid_amount);
        let balanceRevert = 0;
        if (oldInvoice.invoice_type === "sale") {
          balanceRevert = -oldUnpaidAmount;
        } else if (oldInvoice.invoice_type === "sale_return") {
          balanceRevert = oldUnpaidAmount;
        } else if (oldInvoice.invoice_type === "purchase") {
          balanceRevert = oldUnpaidAmount;
        } else if (oldInvoice.invoice_type === "purchase_return") {
          balanceRevert = -oldUnpaidAmount;
        }
        const revertedPartyBalance = round2(Number(party.current_balance) + balanceRevert);
        await client.query(
          "UPDATE parties SET current_balance = $1 WHERE id = $2",
          [revertedPartyBalance, oldInvoice.party_id]
        );
      }
    }

    await client.query("DELETE FROM invoice_items WHERE invoice_id = $1", [invoiceId]);

    let calcSubtotal = 0;
    let calcTaxAmount = 0;
    let calcDiscountAmount = 0;
    const itemsToInsert = [];

    for (const item of items) {
      if (!item.name || !item.quantity || !item.unit_price) {
        throw new ApiError(400, "Each item must have a name, quantity, and unit_price");
      }

      let dbItem = null;
      if (item.item_id) {
        const itemRes = await client.query(
          "SELECT * FROM items WHERE id = $1 AND business_id = $2 FOR UPDATE",
          [item.item_id, businessId]
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
        dbItem,
      });
    }

    const overallDiscount = Number(discount_amount);
    calcDiscountAmount += overallDiscount;
    calcSubtotal -= overallDiscount;

    const transportAmt = transport_cost === undefined ? Number(oldInvoice.transport_cost || 0) : Number(transport_cost || 0);
    const calcTotalAmount = round2(calcSubtotal + calcTaxAmount + transportAmt);
    const paidAmt = Number(paid_amount);

    if (paidAmt > calcTotalAmount) {
      throw new ApiError(400, `Paid amount (${paidAmt}) cannot be greater than total invoice amount (${calcTotalAmount})`);
    }

    let payment_status = "unpaid";
    if (paidAmt >= calcTotalAmount) {
      payment_status = "paid";
    } else if (paidAmt > 0) {
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
        sub_total = $8,
        tax_amount = $9,
        discount_amount = $10,
        total_amount = $11,
        paid_amount = $12,
        payment_status = $13,
        payment_mode = $14,
        notes = $15,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $16
      RETURNING *
    `;

    const invoiceValues = [
      party_id || null,
      invoice_number,
      invoice_type,
      chalan_no === undefined ? oldInvoice.chalan_no : (chalan_no || null),
      transport_cost === undefined ? oldInvoice.transport_cost : Number(transport_cost || 0),
      invoice_date ? new Date(invoice_date) : oldInvoice.invoice_date,
      due_date ? new Date(due_date) : null,
      round2(calcSubtotal),
      round2(calcTaxAmount),
      round2(calcDiscountAmount),
      calcTotalAmount,
      paidAmt,
      payment_status,
      payment_mode,
      notes || null,
      invoiceId,
    ];

    const invoiceResult = await client.query(updateInvoiceQuery, invoiceValues);
    const updatedInvoice = invoiceResult.rows[0];

    for (const item of itemsToInsert) {
      await client.query(
        `INSERT INTO invoice_items (
          invoice_id, item_id, name, quantity, unit_price, 
          discount_percentage, discount_amount, tax_rate, tax_amount, total_amount
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
        ]
      );

    }

    if (party_id) {
      const newPartyRes = await client.query(
        "SELECT * FROM parties WHERE id = $1 FOR UPDATE",
        [party_id]
      );
      if (newPartyRes.rowCount > 0) {
        const party = newPartyRes.rows[0];
        const unpaidAmount = calcTotalAmount - paidAmt;
        let balanceChange = 0;

        if (invoice_type === "sale") {
          balanceChange = unpaidAmount;
        } else if (invoice_type === "sale_return") {
          balanceChange = -unpaidAmount;
        } else if (invoice_type === "purchase") {
          balanceChange = -unpaidAmount;
        } else if (invoice_type === "purchase_return") {
          balanceChange = unpaidAmount;
        }

        const newPartyBalance = round2(Number(party.current_balance) + balanceChange);

        await client.query(
          "UPDATE parties SET current_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
          [newPartyBalance, party_id]
        );
      }
    }

    await client.query("COMMIT");
    await invalidateBusinessCache(businessId);
    res.status(200).json(updatedInvoice);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
