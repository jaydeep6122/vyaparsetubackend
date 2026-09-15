import { ApiError } from "../utils/ApiError.js";
import {
  Decimal,
  dec,
  money,
  percentOf,
  qty,
  rate,
  round,
  sum,
} from "../utils/money.js";

const zeroTax = () => ({ cgst: dec(0), sgst: dec(0), igst: dec(0), cess: dec(0) });
const taxTotal = (tax) => tax.cgst.plus(tax.sgst).plus(tax.igst).plus(tax.cess);

/** Same state as the business = CGST + SGST; anywhere else = IGST. */
export const supplyTypeFor = (businessStateCode, placeOfSupply) =>
  businessStateCode === placeOfSupply ? "intra" : "inter";

function taxOn(taxable, taxRate, cessRate, supplyType) {
  const cess = round(percentOf(taxable, cessRate));
  if (supplyType === "intra") {
    // Each half is rounded on its own, the way it is printed on the bill.
    const half = round(percentOf(taxable, dec(taxRate).dividedBy(2)));
    return { cgst: half, sgst: half, igst: dec(0), cess };
  }
  return { cgst: dec(0), sgst: dec(0), igst: round(percentOf(taxable, taxRate)), cess };
}

/**
 * Prices one invoice line. Discount comes off first and tax is charged on what
 * remains. Non-GST bills never carry tax, whatever rate the item has.
 */
export function computeLine(line, { taxMode, supplyType, priceIncludesTax }) {
  const quantity = dec(line.quantity);
  const unitPrice = dec(line.unit_price);
  const gross = round(quantity.times(unitPrice));

  const discount =
    line.discount_amount != null
      ? round(line.discount_amount)
      : round(percentOf(gross, line.discount_pct ?? 0));
  if (discount.gt(gross)) {
    throw new ApiError(400, `Line ${line.line_no}: discount is more than the line amount`);
  }
  const net = gross.minus(discount);

  const isGst = taxMode === "gst";
  const taxRate = isGst ? dec(line.tax_rate ?? 0) : dec(0);
  const cessRate = isGst ? dec(line.cess_rate ?? 0) : dec(0);

  let taxable = net;
  let tax = zeroTax();
  if (isGst && priceIncludesTax) {
    const estimate = round(net.times(100).dividedBy(dec(100).plus(taxRate).plus(cessRate)));
    tax = taxOn(estimate, taxRate, cessRate, supplyType);
    // Rounding differences stay in the taxable value, so the line still totals
    // exactly the tax-inclusive price that was quoted.
    taxable = net.minus(taxTotal(tax));
  } else if (isGst) {
    tax = taxOn(net, taxRate, cessRate, supplyType);
  }

  const discountPct =
    line.discount_amount != null
      ? gross.isZero()
        ? dec(0)
        : Decimal.min(100, discount.times(100).dividedBy(gross))
      : dec(line.discount_pct ?? 0);

  return {
    line_no: line.line_no,
    item_id: line.item_id ?? null,
    description: line.description,
    hsn_sac: line.hsn_sac ?? null,
    unit_code: line.unit_code ?? null,
    quantity: qty(quantity),
    unit_price: rate(unitPrice),
    discount_pct: round(discountPct).toFixed(2),
    discount_amount: money(discount),
    taxable_value: money(taxable),
    tax_rate: taxRate.toFixed(2),
    cess_rate: cessRate.toFixed(2),
    cgst_amount: money(tax.cgst),
    sgst_amount: money(tax.sgst),
    igst_amount: money(tax.igst),
    cess_amount: money(tax.cess),
    line_total: money(taxable.plus(taxTotal(tax))),
  };
}

/** Freight and other charges: qty x rate, or a flat amount, plus optional GST. */
export function computeCharge(charge, { taxMode }) {
  const amount =
    charge.qty != null ? round(dec(charge.qty).times(charge.rate)) : round(charge.amount);
  const taxRate = taxMode === "gst" ? dec(charge.tax_rate ?? 0) : dec(0);

  return {
    ...charge,
    qty: charge.qty != null ? qty(charge.qty) : null,
    rate: charge.rate != null ? rate(charge.rate) : null,
    amount: money(amount),
    tax_rate: taxRate.toFixed(2),
    tax_amount: money(round(percentOf(amount, taxRate))),
  };
}

/**
 * Prices a whole invoice. Charges billed to the invoice party are part of its
 * total; payee-only charges (e.g. freight owed to a transporter) are not.
 */
export function computeInvoice({ lines, charges, taxMode, supplyType, priceIncludesTax, roundOff }) {
  const computedLines = lines.map((line, index) =>
    computeLine({ ...line, line_no: index + 1 }, { taxMode, supplyType, priceIncludesTax }),
  );
  const computedCharges = charges.map((charge) => computeCharge(charge, { taxMode }));

  const total = (key) => sum(computedLines.map((line) => line[key]));
  const taxable = total("taxable_value");
  const cgst = total("cgst_amount");
  const sgst = total("sgst_amount");
  const igst = total("igst_amount");
  const cess = total("cess_amount");
  const chargesTotal = sum(
    computedCharges
      .filter((charge) => charge.bill_to === "invoice_party")
      .map((charge) => dec(charge.amount).plus(charge.tax_amount)),
  );

  const beforeRounding = taxable.plus(cgst).plus(sgst).plus(igst).plus(cess).plus(chargesTotal);
  const grandTotal = roundOff
    ? beforeRounding.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    : beforeRounding;

  return {
    lines: computedLines,
    charges: computedCharges,
    totals: {
      taxable_total: money(taxable),
      discount_total: money(total("discount_amount")),
      cgst_total: money(cgst),
      sgst_total: money(sgst),
      igst_total: money(igst),
      cess_total: money(cess),
      charges_total: money(chargesTotal),
      round_off: money(grandTotal.minus(beforeRounding)),
      total_amount: money(grandTotal),
    },
  };
}
