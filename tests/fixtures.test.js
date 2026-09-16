import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { bizClient, closeDb, createBusiness, data, signup } from "./helpers.js";

// Captures one real response per endpoint the app parses, so the Flutter side
// can be tested against what the server actually sends.

const OUT = process.env.FIXTURE_DIR ?? "/tmp/api-fixtures";
let biz;
let owner;
let business;
let cash;
let bank;
let customer;
let transporter;
let item;
let invoice;

const save = (name, value) => writeFileSync(`${OUT}/${name}.json`, JSON.stringify(value, null, 2));

beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  owner = await signup();
  business = await createBusiness(owner.auth, {
    opening_cash_balance: 5000,
    bank_account: { name: "HDFC current", bank_name: "HDFC", account_number: "50100123456789", opening_balance: 20000 },
  });
  biz = bizClient(owner.auth, business.id);
  const accounts = data(await biz.get("/accounts", undefined, 200));
  cash = accounts.find((a) => a.account_type === "cash");
  bank = accounts.find((a) => a.account_type === "bank");
});

afterAll(closeDb);

describe("api fixtures", () => {
  it("captures every response the app parses", async () => {
    save("business", business);
    save("accounts", data(await biz.get("/accounts", undefined, 200)));
    save("tax_rates", data(await biz.get("/tax-rates", undefined, 200)));
    save("members", data(await biz.get("/members", undefined, 200)));

    const gst18 = data(await biz.get("/tax-rates", undefined, 200)).find((r) => r.rate === "18.00");
    save("invite", data(await biz.post("/invites", { email: "staff@example.com", role: "staff" }, 201)));
    save("invites", data(await biz.get("/invites", undefined, 200)));

    customer = data(
      await biz.post(
        "/parties",
        { name: "Krishna Hardware", party_type: "customer", state_code: "24", phone: "9876543210", opening_balance: 2500 },
        201,
      ),
    );
    transporter = data(await biz.post("/parties", { name: "Patel Transport", party_type: "transporter" }, 201));
    save("party_create", customer);
    save("party_get", data(await biz.get(`/parties/${customer.id}`, undefined, 200)));
    save("party_list", (await biz.get("/parties", undefined, 200)).body);

    const category = data(await biz.post("/item-categories", { name: "Building material" }, 201));
    save("category", category);
    item = data(
      await biz.post(
        "/items",
        {
          name: "Cement bag",
          hsn_sac: "2523",
          unit_code: "BAG",
          sale_price: 400,
          purchase_price: 320,
          tax_rate_id: gst18.id,
          category_id: category.id,
          low_stock_threshold: 20,
          opening_stock: 100,
          opening_stock_rate: 300,
        },
        201,
      ),
    );
    save("item_create", item);
    save("item_list", (await biz.get("/items", undefined, 200)).body);

    invoice = data(
      await biz.post(
        "/invoices",
        {
          invoice_type: "sale",
          party_id: customer.id,
          vehicle_no: "GJ03AB1234",
          driver_name: "Ramesh",
          transport_mode: "road",
          lr_no: "LR-99",
          eway_bill_no: "123456789012",
          lines: [{ item_id: item.id, quantity: 10, unit_price: 2500 }],
          charges: [
            { charge_type: "transport", amount: 1500, payee_party_id: transporter.id, bill_to: "payee_only", vehicle_no: "GJ03AB1234" },
          ],
          payment: { account_id: cash.id, mode: "cash", amount: 10000 },
        },
        201,
      ),
    );
    save("invoice_create", invoice);
    save("invoice_get", data(await biz.get(`/invoices/${invoice.id}`, undefined, 200)));
    save("invoice_list", (await biz.get("/invoices", undefined, 200)).body);
    // Series rows only exist once a document has been numbered.
    save("document_series", data(await biz.get("/document-series", undefined, 200)));

    const payment = data(
      await biz.post(
        "/payments",
        {
          payment_type: "in",
          party_id: customer.id,
          account_id: bank.id,
          mode: "upi",
          amount: 5000,
          reference_no: "UPI123",
          allocations: [{ invoice_id: invoice.id, amount: 5000 }],
        },
        201,
      ),
    );
    save("payment_create", payment);
    save("payment_get", data(await biz.get(`/payments/${payment.id}`, undefined, 200)));
    save("payment_list", (await biz.get("/payments", undefined, 200)).body);

    const expense = data(
      await biz.post(
        "/expenses",
        {
          expense_date: "2026-09-16",
          taxable_amount: 2000,
          tax_mode: "gst",
          cgst_amount: 180,
          sgst_amount: 180,
          itc_eligible: true,
          payment: { account_id: cash.id, mode: "cash", amount: 2360 },
        },
        201,
      ),
    );
    save("expense_create", expense);
    save("expense_get", data(await biz.get(`/expenses/${expense.id}`, undefined, 200)));
    save("expense_list", (await biz.get("/expenses", undefined, 200)).body);

    const transfer = data(
      await biz.post("/transfers", { from_account_id: cash.id, to_account_id: bank.id, amount: 1000 }, 201),
    );
    save("transfer_create", transfer);
    save("transfer_list", (await biz.get("/transfers", undefined, 200)).body);

    const adjustment = data(
      await biz.post(
        "/stock-adjustments",
        { reason: "damage", notes: "Wet bags", lines: [{ item_id: item.id, quantity: -3 }] },
        201,
      ),
    );
    save("adjustment_create", adjustment);
    save("adjustment_list", (await biz.get("/stock-adjustments", undefined, 200)).body);

    save("dashboard", data(await biz.get("/reports/dashboard", undefined, 200)));
    save("profit_loss", data(await biz.get("/reports/profit-loss", undefined, 200)));
    save("gst_summary", data(await biz.get("/reports/gst-summary", undefined, 200)));
    save("outstanding_receivable", data(await biz.get("/reports/outstanding", { type: "receivable" }, 200)));
    save("outstanding_payable", data(await biz.get("/reports/outstanding", { type: "payable" }, 200)));
    save("day_book", data(await biz.get("/reports/day-book", undefined, 200)));
    save("stock_summary", data(await biz.get("/reports/stock-summary", undefined, 200)));
    save("party_ledger", data(await biz.get(`/reports/party-ledger/${customer.id}`, undefined, 200)));
    save("account_book", data(await biz.get(`/accounts/${cash.id}/book`, undefined, 200)));
    save("item_get", data(await biz.get(`/items/${item.id}`, undefined, 200)));

    console.log(`fixtures written to ${OUT}`);
    expect(true).toBe(true);
  });
});
