import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { dec } from "../src/utils/money.js";
import { bizClient, closeDb, createBusiness, data, signup } from "./helpers.js";

// One GST business in Gujarat shared by every test in this file. Each test
// creates its own parties and checks changes (deltas), so tests stay
// independent of each other's effects on shared items and accounts.
let biz;
let cash;
let cement;
let supplier;
let transporter;
let partySeq = 0;

const balanceOf = async (partyId) => data(await biz.get(`/parties/${partyId}`, undefined, 200)).balance;
const stockOf = async (itemId) => data(await biz.get(`/items/${itemId}`, undefined, 200)).quantity_on_hand;
const accountBalance = async (accountId) => data(await biz.get(`/accounts/${accountId}`, undefined, 200)).balance;
const moneyDelta = (after, before) => dec(after).minus(before).toFixed(2);
const stockDelta = (after, before) => dec(after).minus(before).toFixed(3);

const newParty = async (party_type, extra = {}) =>
  data(await biz.post("/parties", { name: `${party_type} ${++partySeq}`, party_type, ...extra }, 201));

const cashPayment = (amount) => ({ account_id: cash.id, mode: "cash", amount });

beforeAll(async () => {
  const owner = await signup();
  const business = await createBusiness(owner.auth);
  biz = bizClient(owner.auth, business.id);

  cash = data(await biz.get("/accounts", undefined, 200)).find((account) => account.account_type === "cash");
  const gst18 = data(await biz.get("/tax-rates", undefined, 200)).find((rate) => rate.rate === "18.00");
  cement = data(
    await biz.post(
      "/items",
      {
        name: "Cement bag",
        hsn_sac: "2523",
        unit_code: "BAG",
        sale_price: 400,
        purchase_price: 320,
        tax_rate_id: gst18.id,
        opening_stock: 1000,
        opening_stock_rate: 300,
      },
      201,
    ),
  );
  supplier = await newParty("supplier", { state_code: "24" });
  transporter = await newParty("transporter");
});

afterAll(closeDb);

describe("GST and non-GST invoices", () => {
  it("prices an intra-state GST sale with CGST + SGST, takes part payment and moves stock", async () => {
    const customer = await newParty("customer", { state_code: "24" });
    const stockBefore = await stockOf(cement.id);
    const cashBefore = await accountBalance(cash.id);

    const invoice = data(
      await biz.post(
        "/invoices",
        {
          invoice_type: "sale",
          party_id: customer.id,
          vehicle_no: "gj01ab1234",
          lines: [{ item_id: cement.id, quantity: 10 }],
          payment: cashPayment(1000),
        },
        201,
      ),
    );

    expect(invoice.invoice_number).toMatch(/^INV\/\d{2}-\d{2}\/\d+$/);
    expect(invoice).toMatchObject({
      tax_mode: "gst",
      supply_type: "intra",
      place_of_supply: "24",
      taxable_total: "4000.00",
      cgst_total: "360.00",
      sgst_total: "360.00",
      igst_total: "0.00",
      total_amount: "4720.00",
      amount_settled: "1000.00",
      payment_status: "partially_paid",
      outstanding: "3720.00",
      vehicle_no: "GJ01AB1234",
    });
    expect(invoice.lines[0]).toMatchObject({
      description: "Cement bag",
      hsn_sac: "2523",
      unit_code: "BAG",
      unit_price: "400.0000",
      tax_rate: "18.00",
    });
    expect(invoice.payments).toHaveLength(1);

    expect(await balanceOf(customer.id)).toBe("3720.00");
    expect(moneyDelta(await accountBalance(cash.id), cashBefore)).toBe("1000.00");
    expect(stockDelta(await stockOf(cement.id), stockBefore)).toBe("-10.000");
  });

  it("uses IGST for another state and back-calculates tax-inclusive prices", async () => {
    const customer = await newParty("customer", { gstin: "27AAACM1234F1Z1" });
    const invoice = data(
      await biz.post(
        "/invoices",
        {
          invoice_type: "sale",
          party_id: customer.id,
          price_includes_tax: true,
          lines: [{ description: "Floor tiles", hsn_sac: "6907", quantity: 1, unit_price: 1180, tax_rate: 18 }],
        },
        201,
      ),
    );
    expect(invoice).toMatchObject({
      supply_type: "inter",
      place_of_supply: "27",
      party_gstin: "27AAACM1234F1Z1",
      taxable_total: "1000.00",
      igst_total: "180.00",
      cgst_total: "0.00",
      total_amount: "1180.00",
      payment_status: "unpaid",
    });
  });

  it("issues non-GST bills with no tax and their own number series", async () => {
    const customer = await newParty("customer");
    const bill = data(
      await biz.post(
        "/invoices",
        {
          invoice_type: "sale",
          tax_mode: "non_gst",
          party_id: customer.id,
          lines: [{ description: "Loose sand", quantity: 3, unit_price: 250, tax_rate: 18 }],
        },
        201,
      ),
    );
    expect(bill.invoice_number).toMatch(/^BILL\//);
    expect(bill).toMatchObject({
      tax_mode: "non_gst",
      supply_type: null,
      place_of_supply: null,
      taxable_total: "750.00",
      cgst_total: "0.00",
      total_amount: "750.00",
    });
    expect(bill.lines[0].tax_rate).toBe("0.00");
  });

  it("only lets regular GST businesses issue GST invoices", async () => {
    const owner = await signup();
    const shop = await createBusiness(owner.auth, { gst_registration_type: "unregistered", gstin: null });
    const shopBiz = bizClient(owner.auth, shop.id);
    const shopCash = data(await shopBiz.get("/accounts", undefined, 200))[0];
    const tea = [{ description: "Tea", quantity: 2, unit_price: 50 }];
    const payment = { account_id: shopCash.id, mode: "cash", amount: 100 };

    expect((await shopBiz.post("/invoices", { invoice_type: "sale", tax_mode: "gst", lines: tea, payment })).status).toBe(400);
    const bill = data(await shopBiz.post("/invoices", { invoice_type: "sale", lines: tea, payment }, 201));
    expect(bill).toMatchObject({ tax_mode: "non_gst", party_id: null, party_name: "Cash sale", payment_status: "paid" });

    // A party from another business cannot be used, whatever its id.
    const outsider = await newParty("customer");
    expect((await shopBiz.post("/invoices", { invoice_type: "sale", party_id: outsider.id, lines: tea })).status).toBe(400);
  });

  it("requires walk-in sales to be paid in full", async () => {
    const lines = [{ description: "Counter sale", quantity: 1, unit_price: 100, tax_rate: 0 }];
    expect((await biz.post("/invoices", { invoice_type: "sale", lines })).status).toBe(400);
    expect((await biz.post("/invoices", { invoice_type: "sale", lines, payment: cashPayment(50) })).status).toBe(400);
    await biz.post("/invoices", { invoice_type: "sale", lines, payment: cashPayment(100) }, 201);
  });
});

describe("transport", () => {
  it("books freight to the transporter, not the supplier, and settles it separately", async () => {
    const stockBefore = await stockOf(cement.id);
    const cashBefore = await accountBalance(cash.id);
    const supplierBefore = await balanceOf(supplier.id);
    const transporterBefore = await balanceOf(transporter.id);

    const purchase = data(
      await biz.post(
        "/invoices",
        {
          invoice_type: "purchase",
          party_id: supplier.id,
          supplier_invoice_number: "S-778",
          vehicle_no: "GJ05XY9876",
          driver_name: "Suresh",
          lr_no: "LR-55",
          eway_bill_no: "123456789012",
          lines: [{ item_id: cement.id, quantity: 50 }],
          charges: [
            {
              charge_type: "transport",
              payee_party_id: transporter.id,
              qty: 50,
              rate: "12.5",
              paid_now: cashPayment(300),
            },
          ],
        },
        201,
      ),
    );

    expect(purchase.invoice_number).toMatch(/^PUR\//);
    expect(purchase).toMatchObject({
      total_amount: "18880.00",
      charges_total: "0.00",
      supplier_invoice_number: "S-778",
      driver_name: "Suresh",
      lr_no: "LR-55",
      eway_bill_no: "123456789012",
    });
    const [freight] = purchase.charges;
    expect(freight).toMatchObject({
      bill_to: "payee_only",
      qty: "50.000",
      rate: "12.5000",
      amount: "625.00",
      amount_settled: "300.00",
      outstanding: "325.00",
      payee_name: transporter.name,
    });

    expect(moneyDelta(await balanceOf(supplier.id), supplierBefore)).toBe("-18880.00");
    expect(moneyDelta(await balanceOf(transporter.id), transporterBefore)).toBe("-325.00");
    expect(moneyDelta(await accountBalance(cash.id), cashBefore)).toBe("-300.00");
    expect(stockDelta(await stockOf(cement.id), stockBefore)).toBe("50.000");

    // Paying the transporter's balance touches only the freight charge.
    await biz.post(
      "/payments",
      {
        payment_type: "out",
        party_id: transporter.id,
        account_id: cash.id,
        mode: "upi",
        amount: 325,
        allocations: [{ invoice_charge_id: freight.id, amount: 325 }],
      },
      201,
    );
    expect(await balanceOf(transporter.id)).toBe(transporterBefore);
    const reloaded = data(await biz.get(`/invoices/${purchase.id}`, undefined, 200));
    expect(reloaded.charges[0].outstanding).toBe("0.00");
    expect(reloaded.payment_status).toBe("unpaid");

    // The supplier cannot be paid through the transporter's charge.
    const wrongPayee = await biz.post("/payments", {
      payment_type: "out",
      party_id: supplier.id,
      account_id: cash.id,
      mode: "cash",
      amount: 1,
      allocations: [{ invoice_charge_id: freight.id, amount: 1 }],
    });
    expect(wrongPayee.status).toBe(400);
  });
});

describe("payments", () => {
  it("settles several invoices with one receipt, refuses over-allocation, and cancels cleanly", async () => {
    const customer = await newParty("customer");
    const lines = [{ description: "Consulting", quantity: 1, unit_price: 1000, tax_rate: 0 }];
    const first = data(await biz.post("/invoices", { invoice_type: "sale", party_id: customer.id, lines }, 201));
    const second = data(await biz.post("/invoices", { invoice_type: "sale", party_id: customer.id, lines }, 201));
    expect(await balanceOf(customer.id)).toBe("2000.00");

    const receipt = (amount, allocations) => ({
      payment_type: "in",
      party_id: customer.id,
      account_id: cash.id,
      mode: "cash",
      amount,
      allocations,
    });
    expect((await biz.post("/payments", receipt(1200, [{ invoice_id: first.id, amount: 1200 }]))).status).toBe(400);
    expect((await biz.post("/payments", receipt(100, [{ invoice_id: first.id, amount: 200 }]))).status).toBe(400);
    expect(
      (await biz.post("/payments", { ...receipt(100, [{ invoice_id: first.id, amount: 100 }]), payment_type: "out" }))
        .status,
    ).toBe(400);

    const cashBefore = await accountBalance(cash.id);
    const payment = data(
      await biz.post(
        "/payments",
        receipt(1500, [
          { invoice_id: first.id, amount: 1000 },
          { invoice_id: second.id, amount: 500 },
        ]),
        201,
      ),
    );
    expect(payment.payment_number).toMatch(/^REC\//);
    expect(payment).toMatchObject({ amount_allocated: "1500.00", unallocated_amount: "0.00" });
    expect(payment.allocations).toHaveLength(2);
    expect(data(await biz.get(`/invoices/${first.id}`)).payment_status).toBe("paid");
    expect(data(await biz.get(`/invoices/${second.id}`)).payment_status).toBe("partially_paid");
    expect(await balanceOf(customer.id)).toBe("500.00");

    await biz.post(`/payments/${payment.id}/cancel`, { reason: "Cheque bounced" }, 200);
    expect(await balanceOf(customer.id)).toBe("2000.00");
    expect(data(await biz.get(`/invoices/${first.id}`)).payment_status).toBe("unpaid");
    expect(await accountBalance(cash.id)).toBe(cashBefore);
  });

  it("keeps an advance on the party until it is allocated", async () => {
    const customer = await newParty("customer");
    const advance = data(
      await biz.post(
        "/payments",
        { payment_type: "in", party_id: customer.id, account_id: cash.id, mode: "upi", amount: 700 },
        201,
      ),
    );
    expect(advance.unallocated_amount).toBe("700.00");
    expect(await balanceOf(customer.id)).toBe("-700.00");
  });
});

describe("editing and cancelling", () => {
  it("reposts ledgers and stock on edit and refuses a total below what was paid", async () => {
    const customer = await newParty("customer");
    const stockBefore = await stockOf(cement.id);
    const invoice = data(
      await biz.post(
        "/invoices",
        {
          invoice_type: "sale",
          party_id: customer.id,
          lines: [{ item_id: cement.id, quantity: 5 }],
          payment: cashPayment(500),
        },
        201,
      ),
    );
    expect(invoice.total_amount).toBe("2360.00");

    const edited = data(
      await biz.put(
        `/invoices/${invoice.id}`,
        { invoice_type: "sale", party_id: customer.id, lines: [{ item_id: cement.id, quantity: 2 }] },
        200,
      ),
    );
    expect(edited).toMatchObject({ invoice_number: invoice.invoice_number, total_amount: "944.00", amount_settled: "500.00" });
    expect(await balanceOf(customer.id)).toBe("444.00");
    expect(stockDelta(await stockOf(cement.id), stockBefore)).toBe("-2.000");

    const tooLow = await biz.put(`/invoices/${invoice.id}`, {
      invoice_type: "sale",
      party_id: customer.id,
      lines: [{ description: "Tiny", quantity: 1, unit_price: 100, tax_rate: 0 }],
    });
    expect(tooLow.status).toBe(400);

    const switchMode = await biz.put(`/invoices/${invoice.id}`, {
      invoice_type: "sale",
      tax_mode: "non_gst",
      party_id: customer.id,
      lines: [{ item_id: cement.id, quantity: 2 }],
    });
    expect(switchMode.status).toBe(400);
  });

  it("cancels an invoice only after its payments are cancelled", async () => {
    const customer = await newParty("customer");
    const stockBefore = await stockOf(cement.id);
    const invoice = data(
      await biz.post(
        "/invoices",
        {
          invoice_type: "sale",
          party_id: customer.id,
          lines: [{ item_id: cement.id, quantity: 1 }],
          payment: cashPayment(472),
        },
        201,
      ),
    );
    expect(invoice.payment_status).toBe("paid");

    expect((await biz.post(`/invoices/${invoice.id}/cancel`, {})).status).toBe(409);
    await biz.post(`/payments/${invoice.payments[0].payment_id}/cancel`, {}, 200);
    const cancelled = data(await biz.post(`/invoices/${invoice.id}/cancel`, { reason: "Wrong party" }, 200));

    expect(cancelled).toMatchObject({ status: "cancelled", cancel_reason: "Wrong party" });
    expect(await balanceOf(customer.id)).toBe("0.00");
    expect(await stockOf(cement.id)).toBe(stockBefore);
    expect((await biz.put(`/invoices/${invoice.id}`, { invoice_type: "sale", party_id: customer.id, lines: [{ item_id: cement.id, quantity: 1 }] })).status).toBe(400);
  });

  it("links a sale return to its original invoice", async () => {
    const customer = await newParty("customer");
    const sale = data(
      await biz.post("/invoices", { invoice_type: "sale", party_id: customer.id, lines: [{ item_id: cement.id, quantity: 10 }] }, 201),
    );
    const stockAfterSale = await stockOf(cement.id);

    const creditNote = data(
      await biz.post(
        "/invoices",
        {
          invoice_type: "sale_return",
          party_id: customer.id,
          original_invoice_id: sale.id,
          lines: [{ item_id: cement.id, quantity: 2 }],
        },
        201,
      ),
    );
    expect(creditNote.invoice_number).toMatch(/^CN\//);
    expect(creditNote.total_amount).toBe("944.00");
    expect(await balanceOf(customer.id)).toBe("3776.00");
    expect(stockDelta(await stockOf(cement.id), stockAfterSale)).toBe("2.000");

    const wrongOriginal = await biz.post("/invoices", {
      invoice_type: "purchase_return",
      party_id: supplier.id,
      original_invoice_id: sale.id,
      lines: [{ item_id: cement.id, quantity: 1 }],
    });
    expect(wrongOriginal.status).toBe(400);
  });
});

describe("expenses, transfers and stock adjustments", () => {
  it("records an expense owed to a vendor with a part payment", async () => {
    const vendor = await newParty("supplier");
    const cashBefore = await accountBalance(cash.id);

    const expense = data(
      await biz.post("/expenses", { taxable_amount: 1000, party_id: vendor.id, notes: "Shop rent", payment: cashPayment(400) }, 201),
    );
    expect(expense.expense_number).toMatch(/^EXP\//);
    expect(expense).toMatchObject({ total_amount: "1000.00", amount_settled: "400.00", payment_status: "partially_paid" });
    expect(await balanceOf(vendor.id)).toBe("-600.00");
    expect(moneyDelta(await accountBalance(cash.id), cashBefore)).toBe("-400.00");

    expect((await biz.post("/expenses", { taxable_amount: 50 })).status).toBe(400);
    expect((await biz.post("/expenses", { taxable_amount: 100, cgst_amount: 9, party_id: vendor.id })).status).toBe(400);
  });

  it("moves money between accounts and reverses on cancel", async () => {
    const bank = data(await biz.post("/accounts", { name: "SBI Current", account_type: "bank", ifsc: "SBIN0001234" }, 201));
    const cashBefore = await accountBalance(cash.id);

    const transfer = data(await biz.post("/transfers", { from_account_id: cash.id, to_account_id: bank.id, amount: 2000 }, 201));
    expect(await accountBalance(bank.id)).toBe("2000.00");
    expect(moneyDelta(await accountBalance(cash.id), cashBefore)).toBe("-2000.00");
    expect((await biz.post("/transfers", { from_account_id: cash.id, to_account_id: cash.id, amount: 1 })).status).toBe(400);

    await biz.post(`/transfers/${transfer.id}/cancel`, {}, 200);
    expect(await accountBalance(bank.id)).toBe("0.00");
    expect(await accountBalance(cash.id)).toBe(cashBefore);
  });

  it("adjusts stock for tracked items only", async () => {
    const before = await stockOf(cement.id);
    const adjustment = data(
      await biz.post("/stock-adjustments", { reason: "damage", lines: [{ item_id: cement.id, quantity: -3 }] }, 201),
    );
    expect(stockDelta(await stockOf(cement.id), before)).toBe("-3.000");

    await biz.post(`/stock-adjustments/${adjustment.id}/cancel`, {}, 200);
    expect(await stockOf(cement.id)).toBe(before);

    const service = data(await biz.post("/items", { name: "Delivery", item_type: "service" }, 201));
    expect(
      (await biz.post("/stock-adjustments", { reason: "count", lines: [{ item_id: service.id, quantity: 1 }] })).status,
    ).toBe(400);
  });
});

describe("numbering", () => {
  it("gives concurrent invoices unique, gap-free numbers", async () => {
    const customer = await newParty("customer");
    const responses = await Promise.all(
      Array.from({ length: 15 }, () =>
        biz.post("/invoices", {
          invoice_type: "sale",
          tax_mode: "non_gst",
          party_id: customer.id,
          lines: [{ description: "Bulk order", quantity: 1, unit_price: 10 }],
        }),
      ),
    );
    expect(responses.map((res) => res.status)).toEqual(Array(15).fill(201));

    const numbers = responses
      .map((res) => Number(data(res).invoice_number.split("/").pop()))
      .sort((a, b) => a - b);
    numbers.forEach((number, index) => expect(number).toBe(numbers[0] + index));
  });
});

describe("reports", () => {
  it("agree with party, account and item balances", async () => {
    const customer = await newParty("customer");
    await biz.post(
      "/invoices",
      { invoice_type: "sale", party_id: customer.id, lines: [{ item_id: cement.id, quantity: 4 }], payment: cashPayment(100) },
      201,
    );

    const dashboard = data(await biz.get("/reports/dashboard", undefined, 200));
    const parties = data(await biz.get("/parties", { limit: 200 }, 200));
    const receivable = parties
      .map((party) => dec(party.balance))
      .filter((balance) => balance.gt(0))
      .reduce((total, balance) => total.plus(balance), dec(0));
    expect(dashboard.receivable).toBe(receivable.toFixed(2));
    expect(dashboard.cash_balance).toBe(await accountBalance(cash.id));

    const ledger = data(await biz.get(`/parties/${customer.id}/ledger`, undefined, 200));
    expect(ledger.closing_balance).toBe(await balanceOf(customer.id));
    expect(ledger.entries.map((entry) => entry.source_type)).toEqual(["invoice", "payment"]);

    const book = data(await biz.get(`/accounts/${cash.id}/book`, undefined, 200));
    expect(book.closing_balance).toBe(await accountBalance(cash.id));

    const stock = data(await biz.get("/reports/stock-summary", undefined, 200));
    expect(stock.items.find((item) => item.id === cement.id).quantity_on_hand).toBe(await stockOf(cement.id));

    const outstanding = data(await biz.get("/reports/outstanding", { type: "receivable" }, 200));
    const bucketTotal = Object.values(outstanding.buckets).reduce((total, value) => total.plus(value), dec(0));
    expect(bucketTotal.toFixed(2)).toBe(outstanding.total);
    const payables = data(await biz.get("/reports/outstanding", { type: "payable" }, 200));
    expect(payables.documents.map((document) => document.kind)).toEqual(expect.arrayContaining(["invoice", "expense"]));

    const gst = data(await biz.get("/reports/gst-summary", undefined, 200));
    expect(dec(gst.output.cgst).gte(360)).toBe(true);
    expect(gst.hsn_summary.some((row) => row.hsn_sac === "2523")).toBe(true);
    expect(dec(gst.non_gst_sales).gt(0)).toBe(true);

    const profitLoss = data(await biz.get("/reports/profit-loss", undefined, 200));
    expect(dec(profitLoss.gross_profit).minus(profitLoss.expenses).toFixed(2)).toBe(profitLoss.net_profit);

    const dayBook = data(await biz.get("/reports/day-book", undefined, 200));
    expect(dayBook.entries.length).toBeGreaterThan(0);
  });
});
