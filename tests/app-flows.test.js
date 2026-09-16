import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { bizClient, closeDb, createBusiness, data, signup } from "./helpers.js";

// A bill paid in two goes, the way a shop actually does it: part payment with
// the bill, the rest collected later. Every figure the app shows on its money
// screens is checked here, because a single wrong ledger row moves all of them.

let biz;
let cash;
let customer;
let item;

beforeAll(async () => {
  const owner = await signup();
  const business = await createBusiness(owner.auth, { opening_cash_balance: 0 });
  biz = bizClient(owner.auth, business.id);
  cash = data(await biz.get("/accounts", undefined, 200)).find((a) => a.account_type === "cash");
  customer = data(await biz.post("/parties", { name: "Krishna Hardware", party_type: "customer" }, 201));
  item = data(await biz.post("/items", { name: "Steel rod", sale_price: "27500.00" }, 201));
});

afterAll(closeDb);

describe("a bill settled in two payments", () => {
  it("keeps the bill, the party, the cash account and the dashboard in step", async () => {
    const invoice = data(
      await biz.post(
        "/invoices",
        {
          invoice_type: "sale",
          tax_mode: "non_gst",
          status: "final",
          party_id: customer.id,
          lines: [{ item_id: item.id, quantity: "1", unit_code: "NOS", unit_price: "27500.00" }],
          payment: { account_id: cash.id, mode: "cash", amount: "10000.00" },
        },
        201,
      ),
    );

    // Part paid: only what was handed over is settled.
    expect(invoice.total_amount).toBe("27500.00");
    expect(invoice.amount_settled).toBe("10000.00");
    expect(invoice.outstanding).toBe("17500.00");
    expect(invoice.payment_status).toBe("partially_paid");

    expect(data(await biz.get(`/accounts/${cash.id}`, undefined, 200)).balance).toBe("10000.00");
    expect(data(await biz.get(`/parties/${customer.id}`, undefined, 200)).balance).toBe("17500.00");

    // What the app's payment screen offers to settle for this party.
    const open = data(
      await biz.get("/reports/outstanding", { type: "receivable", party_id: customer.id }, 200),
    );
    expect(open.documents).toHaveLength(1);
    expect(open.documents[0]).toMatchObject({ kind: "invoice", outstanding: "17500.00" });

    await biz.post(
      "/payments",
      {
        payment_type: "in",
        party_id: customer.id,
        account_id: cash.id,
        mode: "cash",
        amount: "17500.00",
        allocations: [{ invoice_id: invoice.id, amount: "17500.00" }],
      },
      201,
    );

    const settled = data(await biz.get(`/invoices/${invoice.id}`, undefined, 200));
    expect(settled.amount_settled).toBe("27500.00");
    expect(settled.outstanding).toBe("0.00");
    expect(settled.payment_status).toBe("paid");
    expect(settled.payments).toHaveLength(2);

    expect(data(await biz.get(`/parties/${customer.id}`, undefined, 200)).balance).toBe("0.00");

    const dashboard = data(await biz.get("/reports/dashboard", undefined, 200));
    expect(dashboard).toMatchObject({
      cash_balance: "27500.00",
      receivable: "0.00",
      payable: "0.00",
      received: "27500.00",
    });

    // The cash book reads as two receipts with a running balance.
    const book = data(await biz.get(`/accounts/${cash.id}/book`, undefined, 200));
    expect(book.entries.map((entry) => [entry.amount, entry.balance])).toEqual([
      ["10000.00", "10000.00"],
      ["17500.00", "27500.00"],
    ]);
    expect(book.total_in).toBe("27500.00");
    expect(book.total_out).toBe("0.00");
    expect(book.closing_balance).toBe("27500.00");
  });

  it("an unallocated payment becomes an advance the party is owed", async () => {
    const walkIn = data(await biz.post("/parties", { name: "Advance Customer", party_type: "customer" }, 201));
    await biz.post(
      "/payments",
      { payment_type: "in", party_id: walkIn.id, account_id: cash.id, mode: "cash", amount: "5000.00" },
      201,
    );

    // Negative balance = the business owes it back. The app warns before saving.
    expect(data(await biz.get(`/parties/${walkIn.id}`, undefined, 200)).balance).toBe("-5000.00");
    expect(data(await biz.get("/reports/dashboard", undefined, 200)).payable).toBe("5000.00");
  });

  it("accepts a logo data URI up to the documented limit and rejects a bigger one", async () => {
    const ok = await biz.patch("/", { logo_url: `data:image/png;base64,${"A".repeat(459_000)}` });
    expect(ok.status).toBe(200);

    const tooBig = await biz.patch("/", { logo_url: `data:image/png;base64,${"A".repeat(520_000)}` });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.message).toContain("Image is too large");
  });
});
