import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

export async function createInvoice(req, res) {
  const { businessId } = req.params;
  let { invoice_number } = req.body;
  const {
    party_id,
    invoice_type,
    chalan_no,
    transport_cost = 0,
    invoice_date,
    due_date,
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

    const dupCheck = await client.query(
      "SELECT id FROM invoices WHERE business_id = $1 AND invoice_type = $2 AND invoice_number = $3",
      [businessId, invoice_type, invoice_number]
    );
    if (dupCheck.rowCount > 0) {
      throw new ApiError(400, `Invoice number '${invoice_number}' already exists for this transaction type`);
    }

    let party = null;
    if (party_id) {
      const partyRes = await client.query(
        "SELECT * FROM parties WHERE id = $1 AND business_id = $2 FOR UPDATE",
        [party_id, businessId]
      );
      if (partyRes.rowCount === 0) {
        throw new ApiError(404, "Selected party not found for this business");
      }
      party = partyRes.rows[0];
    }

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

    const calcTotalAmount = round2(calcSubtotal + calcTaxAmount + Number(transport_cost || 0));
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

    const invoiceQuery = `
      INSERT INTO invoices (
        business_id, party_id, invoice_number, invoice_type, chalan_no, transport_cost, invoice_date, 
        due_date, sub_total, tax_amount, discount_amount, total_amount, 
        paid_amount, payment_status, payment_mode, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;

    const invoiceValues = [
      businessId,
      party_id || null,
      invoice_number,
      invoice_type,
      chalan_no || null,
      Number(transport_cost || 0),
      invoice_date ? new Date(invoice_date) : new Date(),
      due_date ? new Date(due_date) : null,
      round2(calcSubtotal),
      round2(calcTaxAmount),
      round2(calcDiscountAmount),
      calcTotalAmount,
      paidAmt,
      payment_status,
      payment_mode,
      notes || null,
    ];

    const invoiceResult = await client.query(invoiceQuery, invoiceValues);
    const savedInvoice = invoiceResult.rows[0];

    for (const item of itemsToInsert) {
      await client.query(
        `INSERT INTO invoice_items (
          invoice_id, item_id, name, quantity, unit_price, 
          discount_percentage, discount_amount, tax_rate, tax_amount, total_amount
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
        ]
      );

    }

    if (party) {
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

    await client.query("COMMIT");
    res.status(201).json(savedInvoice);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
