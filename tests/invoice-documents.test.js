import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { invoiceTitle } from "../src/services/invoice-pdf.js";
import { outbox } from "../src/services/mailer.js";
import { app, bizClient, closeDb, createBusiness, data, signup } from "./helpers.js";

let owner;
let business;
let biz;
let cash;
let customer;
let invoice;

// supertest does not buffer binary bodies by default.
const binaryParser = (res, callback) => {
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
};
const getPdf = (path, auth) => {
  const req = request(app).get(path).buffer(true).parse(binaryParser);
  return auth ? req.set(auth) : req;
};
const pageCount = (pdf) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
const expectPdf = (res) => {
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toBe("application/pdf");
  expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
  expect(res.body.toString("latin1")).toContain("%%EOF");
};

beforeAll(async () => {
  owner = await signup();
  business = await createBusiness(owner.auth, {
    address: { line1: "12 Station Road", city: "Rajkot", state: "Gujarat", pincode: "360001" },
    phone: "9825012345",
    bank_account: {
      name: "HDFC Current",
      bank_name: "HDFC Bank",
      account_number: "50200012345678",
      ifsc: "HDFC0001234",
      upi_id: "shreetraders@hdfcbank",
    },
    settings: { invoice_terms: "Goods once sold will not be taken back." },
  });
  biz = bizClient(owner.auth, business.id);
  cash = data(await biz.get("/accounts", undefined, 200)).find((account) => account.account_type === "cash");
  customer = data(
    await biz.post(
      "/parties",
      {
        name: "Patel Hardware",
        party_type: "customer",
        gstin: "24AAAPR1234C1Z9",
        phone: "98765 43210",
        email: "accounts@patelhardware.example",
        billing_address: { line1: "Main Bazaar", city: "Morbi", pincode: "363641" },
      },
      201,
    ),
  );
  invoice = data(
    await biz.post(
      "/invoices",
      {
        invoice_type: "sale",
        party_id: customer.id,
        vehicle_no: "GJ03AB1234",
        driver_name: "Ramesh",
        eway_bill_no: "123456789012",
        lines: [
          { description: "Cement bag 50kg", hsn_sac: "2523", unit_code: "BAG", quantity: 25, unit_price: 380, tax_rate: 28, discount_pct: 5 },
          { description: "TMT bar 12mm", hsn_sac: "7214", unit_code: "KGS", quantity: "120.5", unit_price: "62.75", tax_rate: 18 },
        ],
        charges: [{ charge_type: "loading", amount: 250, tax_rate: 18 }],
        payment: { account_id: cash.id, mode: "cash", amount: 2000 },
      },
      201,
    ),
  );
});

afterAll(closeDb);
beforeEach(() => {
  outbox.length = 0;
});

describe("invoice PDF", () => {
  it("renders a one-page PDF named after the invoice number", async () => {
    const res = await getPdf(`/v1/businesses/${business.id}/invoices/${invoice.id}/pdf`, owner.auth);
    expectPdf(res);
    expect(res.headers["content-disposition"]).toBe(
      `inline; filename="${invoice.invoice_number.replace(/\//g, "-")}.pdf"`,
    );
    expect(pageCount(res.body)).toBe(1);

    const download = await getPdf(`/v1/businesses/${business.id}/invoices/${invoice.id}/pdf?download=true`, owner.auth);
    expect(download.headers["content-disposition"]).toMatch(/^attachment;/);
  });

  it("flows long invoices onto more pages", async () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ description: `Spare part ${i + 1}`, quantity: 1, unit_price: 10 }));
    const long = data(
      await biz.post("/invoices", { invoice_type: "sale", tax_mode: "non_gst", party_id: customer.id, lines }, 201),
    );
    const res = await getPdf(`/v1/businesses/${business.id}/invoices/${long.id}/pdf`, owner.auth);
    expectPdf(res);
    expect(pageCount(res.body)).toBeGreaterThanOrEqual(2);
  });

  it("names documents by type and tax mode", () => {
    expect(invoiceTitle({ invoice_type: "sale", tax_mode: "gst" })).toBe("TAX INVOICE");
    expect(invoiceTitle({ invoice_type: "sale", tax_mode: "non_gst" })).toBe("BILL OF SUPPLY");
    expect(invoiceTitle({ invoice_type: "sale_return", tax_mode: "gst" })).toBe("CREDIT NOTE");
    expect(invoiceTitle({ invoice_type: "purchase_return", tax_mode: "non_gst" })).toBe("DEBIT NOTE");
  });

  it("renders purchases with freight owed to a transporter, and cancelled invoices", async () => {
    const supplier = data(await biz.post("/parties", { name: "Ambuja Dealer", party_type: "supplier" }, 201));
    const transporter = data(await biz.post("/parties", { name: "Shiv Roadlines", party_type: "transporter" }, 201));
    const purchase = data(
      await biz.post(
        "/invoices",
        {
          invoice_type: "purchase",
          party_id: supplier.id,
          lines: [{ description: "Cement", quantity: 100, unit_price: 300, tax_rate: 28 }],
          charges: [{ charge_type: "transport", payee_party_id: transporter.id, qty: 100, rate: "0.55", vehicle_no: "GJ10Z9999" }],
        },
        201,
      ),
    );
    expectPdf(await getPdf(`/v1/businesses/${business.id}/invoices/${purchase.id}/pdf`, owner.auth));

    await biz.post(`/invoices/${purchase.id}/cancel`, { reason: "Duplicate" }, 200);
    expectPdf(await getPdf(`/v1/businesses/${business.id}/invoices/${purchase.id}/pdf`, owner.auth));
  });

  it("is not available to people outside the business", async () => {
    const stranger = await signup();
    const res = await getPdf(`/v1/businesses/${business.id}/invoices/${invoice.id}/pdf`, stranger.auth);
    expect(res.status).toBe(404);
  });
});

describe("sharing", () => {
  it("creates a WhatsApp-ready link that opens the PDF without logging in", async () => {
    const share = data(await biz.post(`/invoices/${invoice.id}/share`, {}, 200));
    expect(share.url).toContain("/v1/public/invoices/");
    expect(share.whatsapp_url.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    expect(share.message).toContain(invoice.invoice_number);

    const publicPath = new URL(share.url).pathname;
    const res = await getPdf(publicPath);
    expectPdf(res);
    expect(res.headers["x-robots-tag"]).toContain("noindex");

    expect((await getPdf(`${publicPath}x`)).status).toBe(404);
    expect((await getPdf("/v1/public/invoices/not-a-token")).status).toBe(404);
  });

  it("does not accept a share link as an access token", async () => {
    const share = data(await biz.post(`/invoices/${invoice.id}/share`, {}, 200));
    const token = share.url.split("/").pop();
    const res = await request(app).get("/v1/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("refuses to share drafts", async () => {
    const draft = data(
      await biz.post(
        "/invoices",
        { invoice_type: "sale", status: "draft", party_id: customer.id, lines: [{ description: "Quote", quantity: 1, unit_price: 5 }] },
        201,
      ),
    );
    expect((await biz.post(`/invoices/${draft.id}/share`, {})).status).toBe(400);
  });
});

describe("emailing", () => {
  it("emails the PDF to the party", async () => {
    const result = data(await biz.post(`/invoices/${invoice.id}/email`, { message: "Thank you for your business." }, 200));
    expect(result.sent_to).toBe(customer.email);

    expect(outbox).toHaveLength(1);
    const [mail] = outbox;
    expect(mail.subject).toBe(`TAX INVOICE ${invoice.invoice_number} from ${business.name}`);
    expect(mail.text).toContain("Thank you for your business.");
    expect(mail.attachments[0].filename).toMatch(/\.pdf$/);
    expect(mail.attachments[0].content.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("needs an address when the party has none", async () => {
    const walkIn = data(
      await biz.post(
        "/invoices",
        {
          invoice_type: "sale",
          lines: [{ description: "Counter sale", quantity: 1, unit_price: 100 }],
          payment: { account_id: cash.id, mode: "cash", amount: 100 },
        },
        201,
      ),
    );
    expect((await biz.post(`/invoices/${walkIn.id}/email`, {})).status).toBe(400);
    const sent = data(await biz.post(`/invoices/${walkIn.id}/email`, { to: "buyer@example.com" }, 200));
    expect(sent.sent_to).toBe("buyer@example.com");
  });
});
