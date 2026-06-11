import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function updateInvoice(req, res) {
  const { businessId, invoiceId } = req.params;
  const {
    party_id,
    invoice_number,
    invoice_type,
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

    for (const oldItem of oldInvoiceItems) {
      if (oldItem.item_id) {
        const itemRes = await client.query(
          "SELECT * FROM items WHERE id = $1 FOR UPDATE",
          [oldItem.item_id]
        );
        if (itemRes.rowCount > 0) {
          const dbItem = itemRes.rows[0];
          if (dbItem.item_type === "product") {
            let revertChange = 0;
            if (oldInvoice.invoice_type === "sale" || oldInvoice.invoice_type === "purchase_return") {
              revertChange = Number(oldItem.quantity);
            } else if (oldInvoice.invoice_type === "purchase" || oldInvoice.invoice_type === "sale_return") {
              revertChange = -Number(oldItem.quantity);
            }
            const revertedStock = Number(dbItem.current_stock) + revertChange;
            await client.query(
              "UPDATE items SET current_stock = $1 WHERE id = $2",
              [revertedStock, oldItem.item_id]
            );
          }
        }
      }
    }

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

    await client.query("DELETE FROM stock_transactions WHERE reference_id = $1", [invoiceId]);
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

    const calcTotalAmount = round2(calcSubtotal + calcTaxAmount);
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
        invoice_date = $4,
        due_date = $5,
        sub_total = $6,
        tax_amount = $7,
        discount_amount = $8,
        total_amount = $9,
        paid_amount = $10,
        payment_status = $11,
        payment_mode = $12,
        notes = $13,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING *
    `;

    const invoiceValues = [
      party_id || null,
      invoice_number,
      invoice_type,
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

      if (item.dbItem && item.dbItem.item_type === "product") {
        let stockChange = 0;
        let txnType = "sale";

        if (invoice_type === "sale" || invoice_type === "purchase_return") {
          stockChange = -item.quantity;
          txnType = invoice_type;
        } else if (invoice_type === "purchase" || invoice_type === "sale_return") {
          stockChange = item.quantity;
          txnType = invoice_type;
        }

        const freshItemRes = await client.query(
          "SELECT current_stock FROM items WHERE id = $1 FOR UPDATE",
          [item.item_id]
        );
        const freshItem = freshItemRes.rows[0];
        const newStock = Number(freshItem.current_stock) + stockChange;

        if (newStock < 0) {
          throw new ApiError(400, `Insufficient stock for item '${item.name}'. Available: ${freshItem.current_stock}`);
        }

        await client.query(
          "UPDATE items SET current_stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
          [newStock, item.item_id]
        );

        await client.query(
          `INSERT INTO stock_transactions (
            business_id, item_id, transaction_type, quantity, reference_id, notes
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            businessId,
            item.item_id,
            txnType,
            item.quantity,
            invoiceId,
            `Invoice Edited: ${invoice_number}`,
          ]
        );
      }
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
    res.status(200).json(updatedInvoice);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
