import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { bizClient, closeDb, createBusiness, data, signup } from "./helpers.js";

// The mobile forms send every field they know about, using null for "not
// filled in". These tests post exactly those shapes, so a form that the
// server would reject fails here rather than on someone's phone.

let biz;
let cash;
let bank;
let supplier;
let item;

const fails = (res) => (res.status >= 400 ? `${res.status} ${JSON.stringify(res.body)}` : null);

beforeAll(async () => {
  const owner = await signup();
  const business = await createBusiness(owner.auth, { opening_cash_balance: 5000 });
  biz = bizClient(owner.auth, business.id);
  const accounts = data(await biz.get("/accounts", undefined, 200));
  cash = accounts.find((a) => a.account_type === "cash");
  supplier = data(await biz.post("/parties", { name: "Metro Supply", party_type: "supplier" }, 201));
  item = data(await biz.post("/items", { name: "Paint tin", sale_price: 500 }, 201));
});

afterAll(closeDb);

describe("mobile form payloads", () => {
  it("business profile update (logo, signature, settings, address with empty fields)", async () => {
    const res = await biz.patch("/", {
      name: "Shree Traders",
      legal_name: null,
      gst_registration_type: "regular",
      gstin: "24ABCDE1234F1Z5",
      pan: null,
      state_code: "24",
      address: { line1: null, line2: null, city: null, state: "Gujarat", pincode: null },
      phone: null,
      email: null,
      logo_url: null,
      signature_url: null,
      settings: { round_off_invoices: true, invoice_terms: null },
    });
    expect(fails(res)).toBeNull();
  });

  it("bank account create and edit", async () => {
    const created = await biz.post("/accounts", {
      account_type: "bank",
      name: "HDFC current",
      bank_name: "HDFC",
      account_number: "50100123456789",
      ifsc: "HDFC0001234",
      upi_id: null,
      is_default: false,
      opening_balance: "20000",
      opening_balance_date: "2026-09-01",
    });
    expect(fails(created)).toBeNull();
    bank = data(created);

    const edited = await biz.patch(`/accounts/${bank.id}`, {
      name: "HDFC current",
      bank_name: "HDFC",
      account_number: "50100123456789",
      ifsc: "HDFC0001234",
      upi_id: null,
      is_default: false,
      opening_balance: "20000",
      opening_balance_date: "2026-09-01",
    });
    expect(fails(edited)).toBeNull();
  });

  it("tax rate, categories and invite", async () => {
    // Rates a new business is not already seeded with. The app omits an empty
    // name and cess; null must be accepted too.
    expect(fails(await biz.post("/tax-rates", { rate: "7.5" }))).toBeNull();
    expect(fails(await biz.post("/tax-rates", { rate: "13", cess_rate: null, name: null }))).toBeNull();
    expect(fails(await biz.post("/item-categories", { name: "Paints" }))).toBeNull();
    expect(fails(await biz.post("/expense-categories", { name: "Fuel" }))).toBeNull();
    expect(fails(await biz.post("/invites", { email: "staff2@example.com", role: "staff" }))).toBeNull();
  });

  it("expense with GST and a payment made at the same time", async () => {
    const res = await biz.post("/expenses", {
      expense_date: "2026-09-16",
      category_id: null,
      party_id: supplier.id,
      tax_mode: "gst",
      taxable_amount: "2000.00",
      cgst_amount: "180.00",
      sgst_amount: "180.00",
      igst_amount: "0.00",
      cess_amount: "0.00",
      itc_eligible: true,
      notes: null,
      payment: { account_id: cash.id, mode: "cash", amount: "2360.00" },
    });
    expect(fails(res)).toBeNull();
  });

  it("purchase bill with a transporter charge and transport details", async () => {
    const res = await biz.post("/invoices", {
      invoice_type: "purchase",
      tax_mode: "gst",
      status: "final",
      invoice_number: null,
      invoice_date: "2026-09-16",
      due_date: null,
      supplier_invoice_number: "SUP-77",
      supplier_invoice_date: "2026-09-15",
      party_id: supplier.id,
      party_name: null,
      is_reverse_charge: false,
      price_includes_tax: false,
      vehicle_no: "GJ03AB1234",
      driver_name: "Ramesh",
      driver_phone: "9876543210",
      transport_mode: "road",
      lr_no: "LR-1",
      lr_date: "2026-09-16",
      eway_bill_no: "123456789012",
      eway_bill_date: "2026-09-16",
      chalan_no: "CH-1",
      delivery_date: "2026-09-17",
      notes: null,
      terms: null,
      lines: [
        {
          item_id: item.id,
          description: "Paint tin",
          hsn_sac: null,
          quantity: "4",
          unit_code: "NOS",
          unit_price: "450.00",
          tax_rate: "18.00",
          cess_rate: "0.00",
        },
      ],
      charges: [
        {
          charge_type: "transport",
          description: "Freight",
          bill_to: "invoice_party",
          payee_party_id: null,
          vehicle_no: "GJ03AB1234",
          amount: "800.00",
          tax_rate: "0.00",
        },
      ],
    });
    expect(fails(res)).toBeNull();
  });

  it("transfer and stock adjustment", async () => {
    expect(
      fails(
        await biz.post("/transfers", {
          transfer_date: "2026-09-16",
          from_account_id: cash.id,
          to_account_id: bank.id,
          amount: "1000.00",
          notes: null,
        }),
      ),
    ).toBeNull();

    expect(
      fails(
        await biz.post("/stock-adjustments", {
          adjustment_date: "2026-09-16",
          reason: "damage",
          notes: null,
          lines: [{ item_id: item.id, quantity: "-2", unit_cost: null }],
        }),
      ),
    ).toBeNull();
  });

  it("edit forms send every field again, with nulls for the empty ones", async () => {
    const party = data(await biz.get(`/parties/${supplier.id}`, undefined, 200));
    expect(
      fails(
        await biz.patch(`/parties/${party.id}`, {
          name: party.name,
          party_type: "supplier",
          phone: null,
          email: null,
          gst_type: "unregistered",
          gstin: null,
          state_code: null,
          billing_address: null,
          shipping_address: null,
          credit_limit: null,
          credit_days: null,
          notes: null,
          opening_balance: "0",
          opening_balance_type: "receivable",
        }),
      ),
    ).toBeNull();

    expect(
      fails(
        await biz.patch(`/items/${item.id}`, {
          name: "Paint tin",
          item_type: "goods",
          category_id: null,
          sku: null,
          barcode: null,
          hsn_sac: null,
          unit_code: "NOS",
          sale_price: "500.00",
          purchase_price: null,
          price_includes_tax: false,
          tax_rate_id: null,
          track_stock: true,
          low_stock_threshold: null,
        }),
      ),
    ).toBeNull();

    const series = data(await biz.get("/document-series", undefined, 200));
    if (series.length) {
      expect(
        fails(await biz.patch(`/document-series/${series[0].id}`, { prefix: "BILL/", next_number: 5, padding: 3 })),
      ).toBeNull();
    }

    const categories = data(await biz.get("/item-categories", undefined, 200));
    if (categories.length) {
      expect(fails(await biz.patch(`/item-categories/${categories[0].id}`, { name: "Paints & putty" }))).toBeNull();
    }
  });

  it("replaces a bill, a payment and an expense the way the edit screens do", async () => {
    const customer = data(await biz.post("/parties", { name: "Edit Customer", party_type: "customer" }, 201));
    const invoice = data(
      await biz.post(
        "/invoices",
        {
          invoice_type: "sale",
          tax_mode: "non_gst",
          status: "final",
          party_id: customer.id,
          lines: [{ item_id: item.id, description: "Paint tin", quantity: "2", unit_code: "NOS", unit_price: "500.00" }],
          charges: [],
        },
        201,
      ),
    );

    // PUT sends the whole bill again, exactly as the form builds it.
    const replaced = await biz.put(`/invoices/${invoice.id}`, {
      invoice_type: "sale",
      tax_mode: "non_gst",
      status: "final",
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      due_date: null,
      supplier_invoice_number: null,
      supplier_invoice_date: null,
      party_id: customer.id,
      party_name: null,
      is_reverse_charge: false,
      price_includes_tax: false,
      vehicle_no: null,
      driver_name: null,
      driver_phone: null,
      transport_mode: null,
      lr_no: null,
      lr_date: null,
      eway_bill_no: null,
      eway_bill_date: null,
      chalan_no: null,
      delivery_date: null,
      notes: null,
      terms: null,
      lines: [{ item_id: item.id, description: "Paint tin", quantity: "3", unit_code: "NOS", unit_price: "500.00" }],
      charges: [],
    });
    expect(fails(replaced)).toBeNull();
    expect(data(replaced).total_amount).toBe("1500.00");

    const payment = data(
      await biz.post(
        "/payments",
        {
          payment_type: "in",
          payment_date: "2026-09-16",
          party_id: customer.id,
          account_id: cash.id,
          mode: "cash",
          amount: "500.00",
          reference_no: null,
          cheque_no: null,
          cheque_date: null,
          notes: null,
          allocations: [{ invoice_id: invoice.id, amount: "500.00" }],
        },
        201,
      ),
    );
    const editedPayment = await biz.put(`/payments/${payment.id}`, {
      payment_date: "2026-09-16",
      party_id: customer.id,
      account_id: cash.id,
      mode: "cash",
      amount: "900.00",
      reference_no: null,
      cheque_no: null,
      cheque_date: null,
      notes: null,
      allocations: [{ invoice_id: invoice.id, amount: "900.00" }],
    });
    expect(fails(editedPayment)).toBeNull();

    const expense = data(
      await biz.post("/expenses", { taxable_amount: "1000.00", tax_mode: "non_gst", party_id: supplier.id }, 201),
    );
    const editedExpense = await biz.put(`/expenses/${expense.id}`, {
      expense_date: "2026-09-16",
      category_id: null,
      party_id: supplier.id,
      tax_mode: "non_gst",
      taxable_amount: "1200.00",
      cgst_amount: "0.00",
      sgst_amount: "0.00",
      igst_amount: "0.00",
      cess_amount: "0.00",
      itc_eligible: false,
      notes: null,
    });
    expect(fails(editedExpense)).toBeNull();
  });

  it("walk-in cash sale paid in full", async () => {
    const total = "500.00";
    const res = await biz.post("/invoices", {
      invoice_type: "sale",
      tax_mode: "non_gst",
      status: "final",
      invoice_number: null,
      invoice_date: "2026-09-16",
      party_id: null,
      party_name: "Walk-in",
      lines: [{ item_id: item.id, description: "Paint tin", quantity: "1", unit_code: "NOS", unit_price: total }],
      charges: [],
      payment: { account_id: cash.id, mode: "cash", amount: total },
    });
    expect(fails(res)).toBeNull();
  });
});
