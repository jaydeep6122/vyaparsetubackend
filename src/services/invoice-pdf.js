import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import {
  amountInWords,
  formatDate,
  formatINR,
  formatPercent,
  formatQuantity,
  formatRate,
  stateName,
} from "../utils/format.js";
import { dec, money, sum } from "../utils/money.js";

// Rendered with PDFKit's built-in Helvetica, which covers Latin text only:
// names written in Gujarati, Hindi or other Indian scripts will not print
// correctly until a Unicode font with shaping support is added.

const TITLES = {
  sale: { gst: "TAX INVOICE", non_gst: "BILL OF SUPPLY" },
  purchase: { gst: "PURCHASE INVOICE", non_gst: "PURCHASE BILL" },
  sale_return: { gst: "CREDIT NOTE", non_gst: "CREDIT NOTE" },
  purchase_return: { gst: "DEBIT NOTE", non_gst: "DEBIT NOTE" },
};

export const invoiceTitle = (invoice) => TITLES[invoice.invoice_type][invoice.tax_mode];

const FONT = "Helvetica";
const BOLD = "Helvetica-Bold";
const INK = "#1a1a1a";
const MUTED = "#5f6368";
const RULE = "#d0d4d9";
const ACCENT = "#1f3a5f";
const SHADE = "#f2f4f7";

const isZero = (value) => dec(value ?? 0).isZero();
const humanize = (text) => text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, " ");
const joinParts = (...parts) => parts.filter(Boolean).join(" / ");

const addressLines = (address) =>
  address
    ? [
        address.line1,
        address.line2,
        [address.city, address.state, address.pincode].filter(Boolean).join(", "),
        address.country,
      ].filter(Boolean)
    : [];

/** UPI deep link for the balance due, printed as a QR code on sale invoices. */
function upiLink({ business, invoice, bankAccount }) {
  const due = dec(invoice.total_amount).minus(invoice.amount_settled);
  if (!bankAccount?.upi_id || invoice.invoice_type !== "sale" || invoice.status !== "final" || !due.gt(0)) {
    return null;
  }
  const params = {
    pa: bankAccount.upi_id,
    pn: business.name,
    am: money(due),
    cu: "INR",
    tn: `Invoice ${invoice.invoice_number}`,
  };
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `upi://pay?${query}`;
}

/** Taxable value and tax per GST rate, as printed under the totals. */
function gstBreakup(lines) {
  const byRate = new Map();
  for (const line of lines) {
    const row = byRate.get(line.tax_rate) ?? { rate: line.tax_rate, lines: [] };
    row.lines.push(line);
    byRate.set(line.tax_rate, row);
  }
  const total = (rows, key) => money(sum(rows.map((row) => row[key])));
  return [...byRate.values()]
    .sort((a, b) => dec(a.rate).cmp(b.rate))
    .map(({ rate, lines: rows }) => ({
      rate,
      taxable: total(rows, "taxable_value"),
      cgst: total(rows, "cgst_amount"),
      sgst: total(rows, "sgst_amount"),
      igst: total(rows, "igst_amount"),
    }));
}

/** Renders an invoice (as returned by getInvoice) to an A4 PDF buffer. */
export async function renderInvoicePdf({ business, invoice, bankAccount }) {
  const upi = upiLink({ business, invoice, bankAccount });
  const qrCode = upi ? await QRCode.toBuffer(upi, { type: "png", margin: 1, width: 240 }) : null;
  const title = invoiceTitle(invoice);
  const isGst = invoice.tax_mode === "gst";

  const doc = new PDFDocument({
    size: "A4",
    margin: 36,
    bufferPages: true,
    info: { Title: `${title} ${invoice.invoice_number}`, Author: business.name, Creator: "VyaparSetu" },
  });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const right = left + width;
  // Room kept at the bottom of every page for the footer.
  const pageBottom = () => doc.page.height - doc.page.margins.bottom - 20;
  let y = doc.page.margins.top;

  const ensureSpace = (height) => {
    if (y + height <= pageBottom()) return false;
    doc.addPage();
    y = doc.page.margins.top;
    return true;
  };
  const rule = (at, from = left, to = right, color = RULE) =>
    doc.moveTo(from, at).lineTo(to, at).lineWidth(0.6).strokeColor(color).stroke();
  const label = (text, x, at, labelWidth) =>
    doc.font(BOLD).fontSize(7.5).fillColor(MUTED).text(text.toUpperCase(), x, at, { width: labelWidth, characterSpacing: 0.4 });

  // ---- Header: business on the left, document details on the right --------
  const headerWidth = width * 0.58;
  doc.font(BOLD).fontSize(16).fillColor(ACCENT).text(business.name, left, y, { width: headerWidth });
  const businessLines = [
    business.legal_name && business.legal_name !== business.name ? business.legal_name : null,
    ...addressLines(business.address),
    [business.phone && `Phone: ${business.phone}`, business.email && `Email: ${business.email}`].filter(Boolean).join("   "),
    [business.gstin && `GSTIN: ${business.gstin}`, business.pan && `PAN: ${business.pan}`].filter(Boolean).join("   "),
  ].filter(Boolean);
  doc.font(FONT).fontSize(8.5).fillColor(MUTED).text(businessLines.join("\n"), left, doc.y + 2, {
    width: headerWidth,
    lineGap: 1,
  });
  const businessBottom = doc.y;

  const metaX = left + headerWidth + 10;
  const metaWidth = right - metaX;
  doc.font(BOLD).fontSize(14).fillColor(ACCENT).text(title, metaX, y, { width: metaWidth, align: "right" });
  const meta = [
    ["No.", invoice.invoice_number],
    ["Date", formatDate(invoice.invoice_date)],
    invoice.due_date && ["Due date", formatDate(invoice.due_date)],
    invoice.supplier_invoice_number && [
      "Supplier bill",
      joinParts(invoice.supplier_invoice_number, formatDate(invoice.supplier_invoice_date)),
    ],
    invoice.place_of_supply && [
      "Place of supply",
      `${stateName(invoice.place_of_supply)} (${invoice.place_of_supply})`,
    ],
    isGst && ["Reverse charge", invoice.is_reverse_charge ? "Yes" : "No"],
  ].filter(Boolean);
  let metaY = doc.y + 4;
  for (const [key, value] of meta) {
    doc.font(FONT).fontSize(9).fillColor(INK).text(`${key}: ${value}`, metaX, metaY, { width: metaWidth, align: "right" });
    metaY = doc.y + 1;
  }

  y = Math.max(businessBottom, metaY) + 10;
  rule(y);
  y += 10;

  // ---- Parties ---------------------------------------------------------------
  const columnWidth = (width - 20) / 2;
  const partyBlock = (heading, lines, x) => {
    label(heading, x, y, columnWidth);
    doc.font(BOLD).fontSize(10.5).fillColor(INK).text(invoice.party_name, x, doc.y + 2, { width: columnWidth });
    if (lines.length) {
      doc.font(FONT).fontSize(8.5).fillColor(INK).text(lines.join("\n"), x, doc.y + 1, { width: columnWidth, lineGap: 1 });
    }
    return doc.y;
  };
  const billBottom = partyBlock(
    invoice.invoice_type.startsWith("sale") ? "Bill to" : "Supplier",
    [
      ...addressLines(invoice.billing_address),
      invoice.party_gstin && `GSTIN: ${invoice.party_gstin}`,
      invoice.party_state_code && `State: ${stateName(invoice.party_state_code)} (${invoice.party_state_code})`,
    ].filter(Boolean),
    left,
  );
  const shipAddress = invoice.ship_to ?? invoice.shipping_address;
  const shipBottom = shipAddress ? partyBlock("Ship to", addressLines(shipAddress), left + columnWidth + 20) : y;
  y = Math.max(billBottom, shipBottom) + 10;

  // ---- Transport & delivery ------------------------------------------------
  const transport = [
    invoice.vehicle_no && `Vehicle: ${invoice.vehicle_no}`,
    invoice.driver_name && `Driver: ${[invoice.driver_name, invoice.driver_phone].filter(Boolean).join(", ")}`,
    invoice.transport_mode && `Mode: ${humanize(invoice.transport_mode)}`,
    invoice.lr_no && `LR: ${joinParts(invoice.lr_no, formatDate(invoice.lr_date))}`,
    invoice.eway_bill_no && `E-way bill: ${joinParts(invoice.eway_bill_no, formatDate(invoice.eway_bill_date))}`,
    invoice.chalan_no && `Challan: ${invoice.chalan_no}`,
    invoice.delivery_date && `Delivery: ${formatDate(invoice.delivery_date)}`,
    invoice.dispatch_from && `Dispatch from: ${addressLines(invoice.dispatch_from).join(", ")}`,
  ].filter(Boolean);
  if (transport.length) {
    // A fixed grid, so a detail never breaks across lines or runs into the next one.
    const perRow = 3;
    const cellWidth = (width - 16) / perRow;
    const rows = [];
    for (let index = 0; index < transport.length; index += perRow) {
      rows.push(transport.slice(index, index + perRow));
    }
    doc.font(FONT).fontSize(8);
    const rowHeights = rows.map((row) =>
      Math.max(...row.map((detail) => doc.heightOfString(detail, { width: cellWidth - 8 }))),
    );
    const height = rowHeights.reduce((total, rowHeight) => total + rowHeight + 3, 0) + 7;

    doc.rect(left, y, width, height).fill(SHADE);
    let rowY = y + 5;
    rows.forEach((row, rowIndex) => {
      row.forEach((detail, column) => {
        doc.font(FONT).fontSize(8).fillColor(INK).text(detail, left + 8 + column * cellWidth, rowY, {
          width: cellWidth - 8,
        });
      });
      rowY += rowHeights[rowIndex] + 3;
    });
    y += height + 10;
  }

  // ---- Line items ----------------------------------------------------------
  const columns = isGst
    ? [
        { key: "no", label: "#", width: 20 },
        { key: "item", label: "Item", width: 168 },
        { key: "hsn", label: "HSN/SAC", width: 50 },
        { key: "qty", label: "Qty", width: 58, align: "right" },
        { key: "rate", label: "Rate", width: 58, align: "right" },
        { key: "taxable", label: "Taxable", width: 64, align: "right" },
        { key: "gst", label: "GST", width: 40, align: "right" },
        { key: "amount", label: "Amount", width: width - 458, align: "right" },
      ]
    : [
        { key: "no", label: "#", width: 20 },
        { key: "item", label: "Item", width: width - 245 },
        { key: "qty", label: "Qty", width: 70, align: "right" },
        { key: "rate", label: "Rate", width: 70, align: "right" },
        { key: "amount", label: "Amount", width: 85, align: "right" },
      ];

  const drawTableHeader = () => {
    doc.rect(left, y, width, 18).fill(ACCENT);
    let x = left;
    for (const column of columns) {
      doc.font(BOLD).fontSize(8).fillColor("white").text(column.label, x + 4, y + 5, {
        width: column.width - 8,
        align: column.align ?? "left",
        lineBreak: false,
      });
      x += column.width;
    }
    y += 18;
  };

  const drawRow = (cells, { shaded = false } = {}) => {
    doc.font(FONT).fontSize(8.5);
    const height =
      Math.max(...columns.map((column) => doc.heightOfString(String(cells[column.key] ?? ""), { width: column.width - 8 }))) + 8;
    if (ensureSpace(height)) drawTableHeader();
    if (shaded) doc.rect(left, y, width, height).fill(SHADE);

    let x = left;
    for (const column of columns) {
      doc.font(FONT).fontSize(8.5).fillColor(INK).text(String(cells[column.key] ?? ""), x + 4, y + 4, {
        width: column.width - 8,
        align: column.align ?? "left",
      });
      x += column.width;
    }
    y += height;
    rule(y);
  };

  drawTableHeader();
  invoice.lines.forEach((line, index) => {
    const discount = isZero(line.discount_amount)
      ? ""
      : `\nDiscount ${formatPercent(line.discount_pct)} (-${formatINR(line.discount_amount)})`;
    drawRow(
      {
        no: index + 1,
        item: `${line.description}${discount}`,
        hsn: line.hsn_sac ?? "",
        qty: `${formatQuantity(line.quantity)}${line.unit_code ? ` ${line.unit_code}` : ""}`,
        rate: formatRate(line.unit_price),
        taxable: formatINR(line.taxable_value),
        gst: formatPercent(line.tax_rate),
        amount: formatINR(line.line_total),
      },
      { shaded: index % 2 === 1 },
    );
  });

  for (const charge of invoice.charges.filter((c) => c.bill_to === "invoice_party")) {
    const basis = charge.qty != null ? ` (${formatQuantity(charge.qty)} x ${formatRate(charge.rate)})` : "";
    drawRow({
      no: "",
      item: `${humanize(charge.charge_type)} charges${basis}${charge.description ? `\n${charge.description}` : ""}`,
      taxable: formatINR(charge.amount),
      gst: formatPercent(charge.tax_rate),
      amount: formatINR(dec(charge.amount).plus(charge.tax_amount)),
    });
  }

  // ---- Totals (right) with amount in words and GST breakup (left) ---------
  y += 10;
  const totalsWidth = 210;
  const totalsX = right - totalsWidth;
  const leftWidth = totalsX - left - 20;

  const totals = [
    ["Taxable value", invoice.taxable_total],
    !isZero(invoice.cgst_total) && ["CGST", invoice.cgst_total],
    !isZero(invoice.sgst_total) && ["SGST", invoice.sgst_total],
    !isZero(invoice.igst_total) && ["IGST", invoice.igst_total],
    !isZero(invoice.cess_total) && ["Cess", invoice.cess_total],
    !isZero(invoice.charges_total) && ["Other charges", invoice.charges_total],
    !isZero(invoice.round_off) && ["Round off", invoice.round_off],
  ].filter(Boolean);
  const settlement =
    invoice.status === "final" && !isZero(invoice.amount_settled)
      ? [
          ["Paid", invoice.amount_settled],
          ["Balance due", invoice.outstanding],
        ]
      : [];
  const breakup = isGst ? gstBreakup(invoice.lines) : [];
  ensureSpace(Math.max((totals.length + settlement.length) * 14 + 30, 50 + (breakup.length ? 30 + breakup.length * 13 : 0)));
  const sectionTop = y;

  let totalsY = sectionTop;
  const totalRow = (text, value, { bold = false } = {}) => {
    doc.font(bold ? BOLD : FONT).fontSize(bold ? 10.5 : 9).fillColor(INK);
    doc.text(text, totalsX, totalsY, { width: 110 });
    doc.text(formatINR(value), totalsX + 110, totalsY, { width: totalsWidth - 110, align: "right" });
    totalsY += bold ? 18 : 14;
  };
  totals.forEach(([text, value]) => totalRow(text, value));
  rule(totalsY, totalsX, right, INK);
  totalsY += 4;
  totalRow("Total", invoice.total_amount, { bold: true });
  settlement.forEach(([text, value]) => totalRow(text, value));

  label("Amount in words", left, sectionTop, leftWidth);
  doc.font(FONT).fontSize(9).fillColor(INK).text(amountInWords(invoice.total_amount), left, doc.y + 2, { width: leftWidth });
  let leftY = doc.y + 10;

  if (breakup.length) {
    const taxColumns =
      invoice.supply_type === "inter"
        ? [["Rate", 50, "rate"], ["Taxable", 90, "taxable"], ["IGST", 80, "igst"]]
        : [["Rate", 40, "rate"], ["Taxable", 75, "taxable"], ["CGST", 60, "cgst"], ["SGST", 60, "sgst"]];
    const drawTaxRow = (cells, bold) => {
      let x = left;
      for (const [heading, columnWidthPx, key] of taxColumns) {
        const value = cells ? (key === "rate" ? formatPercent(cells.rate) : formatINR(cells[key])) : heading;
        doc.font(bold ? BOLD : FONT).fontSize(8).fillColor(bold ? MUTED : INK).text(value, x, leftY, {
          width: columnWidthPx - 6,
          align: key === "rate" ? "left" : "right",
        });
        x += columnWidthPx;
      }
      leftY += 13;
    };
    label("GST breakup", left, leftY, leftWidth);
    leftY = doc.y + 3;
    drawTaxRow(null, true);
    breakup.forEach((row) => drawTaxRow(row, false));
  }

  y = Math.max(totalsY, leftY) + 14;

  // ---- Freight paid separately (purchase documents only) -------------------
  const separateCharges = invoice.invoice_type.startsWith("purchase")
    ? invoice.charges.filter((charge) => charge.bill_to === "payee_only")
    : [];
  if (separateCharges.length) {
    const lines = separateCharges.map((charge) => {
      const vehicle = charge.vehicle_no ? ` (${charge.vehicle_no})` : "";
      const total = formatINR(dec(charge.amount).plus(charge.tax_amount));
      return `${humanize(charge.charge_type)} to ${charge.payee_name}${vehicle}: ${total}, paid ${formatINR(charge.amount_settled)}`;
    });
    ensureSpace(16 + lines.length * 12);
    label("Charges payable separately", left, y, width);
    doc.font(FONT).fontSize(8.5).fillColor(INK).text(lines.join("\n"), left, doc.y + 2, { width });
    y = doc.y + 12;
  }

  // ---- Bank details and UPI QR (sale invoices) -----------------------------
  const bankLines =
    invoice.invoice_type === "sale" && bankAccount
      ? [
          bankAccount.bank_name && `Bank: ${bankAccount.bank_name}`,
          bankAccount.account_number && `A/c no: ${bankAccount.account_number}`,
          bankAccount.ifsc && `IFSC: ${bankAccount.ifsc}`,
          bankAccount.upi_id && `UPI: ${bankAccount.upi_id}`,
        ].filter(Boolean)
      : [];
  if (bankLines.length || qrCode) {
    ensureSpace(qrCode ? 104 : 18 + bankLines.length * 12);
    const blockTop = y;
    if (bankLines.length) {
      label("Bank details", left, blockTop, leftWidth);
      doc.font(FONT).fontSize(8.5).fillColor(INK).text(bankLines.join("\n"), left, doc.y + 2, { width: leftWidth, lineGap: 1 });
    }
    const bankBottom = doc.y;
    if (qrCode) {
      doc.image(qrCode, right - 84, blockTop, { width: 84 });
      doc.font(FONT).fontSize(7.5).fillColor(MUTED).text(
        `Scan to pay ${formatINR(invoice.outstanding)} by UPI`,
        right - 160,
        blockTop + 87,
        { width: 160, align: "right" },
      );
    }
    y = Math.max(bankBottom, qrCode ? blockTop + 100 : 0) + 10;
  }

  // ---- Notes, terms and signature --------------------------------------------
  const textBlock = (heading, text) => {
    doc.font(FONT).fontSize(8.5);
    ensureSpace(doc.heightOfString(text, { width }) + 18);
    label(heading, left, y, width);
    doc.font(FONT).fontSize(8.5).fillColor(INK).text(text, left, doc.y + 2, { width });
    y = doc.y + 10;
  };
  if (invoice.notes) textBlock("Notes", invoice.notes);
  const terms = invoice.terms ?? business.settings?.invoice_terms;
  if (terms) textBlock("Terms & conditions", terms);

  ensureSpace(60);
  doc.font(BOLD).fontSize(9).fillColor(INK).text(`For ${business.name}`, right - 220, y + 4, { width: 220, align: "right" });
  doc.font(FONT).fontSize(8).fillColor(MUTED).text("Authorised signatory", right - 220, y + 44, { width: 220, align: "right" });

  // ---- Footer and status watermark on every page -----------------------------
  const pages = doc.bufferedPageRange();
  for (let index = 0; index < pages.count; index++) {
    doc.switchToPage(pages.start + index);
    // Writing below the bottom margin would otherwise start a new page.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const footerY = doc.page.height - 26;
    doc.font(FONT).fontSize(7.5).fillColor(MUTED);
    doc.text(`${title} ${invoice.invoice_number} - computer-generated document`, left, footerY, {
      width: width * 0.75,
      lineBreak: false,
    });
    doc.text(`Page ${index + 1} of ${pages.count}`, left, footerY, { width, align: "right", lineBreak: false });

    if (invoice.status !== "final") {
      doc
        .save()
        .rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] })
        .font(BOLD)
        .fontSize(96)
        .fillColor(invoice.status === "cancelled" ? "#c62828" : "#9e9e9e")
        .opacity(0.12)
        .text(invoice.status.toUpperCase(), 0, doc.page.height / 2 - 48, {
          width: doc.page.width,
          align: "center",
          lineBreak: false,
        })
        .restore();
    }
    doc.page.margins.bottom = bottomMargin;
  }

  doc.end();
  return finished;
}
