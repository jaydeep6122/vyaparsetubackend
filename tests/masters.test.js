import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { bizClient, closeDb, createBusiness, data, signup } from "./helpers.js";

let biz;

beforeAll(async () => {
  const owner = await signup();
  const business = await createBusiness(owner.auth);
  biz = bizClient(owner.auth, business.id);
});

afterAll(closeDb);

describe("parties", () => {
  it("keeps opening balances in the ledger and supports edit, search and archive", async () => {
    const party = data(
      await biz.post(
        "/parties",
        {
          name: "Ramesh Traders",
          party_type: "customer",
          gstin: "24aaapr1234c1z9",
          opening_balance: 1500,
          opening_balance_type: "receivable",
        },
        201,
      ),
    );
    expect(party).toMatchObject({
      gstin: "24AAAPR1234C1Z9",
      gst_type: "registered",
      state_code: "24",
      balance: "1500.00",
      opening_balance: "1500.00",
      opening_balance_type: "receivable",
    });

    expect((await biz.post("/parties", { name: "ramesh traders", party_type: "supplier" })).status).toBe(409);

    const updated = data(
      await biz.patch(
        `/parties/${party.id}`,
        { opening_balance: 200, opening_balance_type: "payable", phone: "9876543210" },
        200,
      ),
    );
    expect(updated).toMatchObject({ balance: "-200.00", balance_type: "payable", phone: "9876543210" });
    expect(data(await biz.patch(`/parties/${party.id}`, { phone: null }, 200)).phone).toBeNull();

    const found = await biz.get("/parties", { search: "ramesh", party_type: "customer" }, 200);
    expect(data(found).map((p) => p.id)).toContain(party.id);
    expect(found.body.pagination).toMatchObject({ limit: 50, offset: 0 });

    await biz.post(`/parties/${party.id}/archive`, {}, 200);
    expect(data(await biz.get("/parties", undefined, 200)).map((p) => p.id)).not.toContain(party.id);
    expect(data(await biz.get("/parties", { include_archived: "true" }, 200)).map((p) => p.id)).toContain(party.id);
  });

  it("requires a GSTIN that matches the state for registered parties", async () => {
    expect((await biz.post("/parties", { name: "No GSTIN", party_type: "supplier", gst_type: "registered" })).status).toBe(
      400,
    );
    expect(
      (await biz.post("/parties", { name: "Wrong state", party_type: "supplier", gstin: "24AAAPR1234C1Z9", state_code: "27" }))
        .status,
    ).toBe(400);
  });
});

describe("items", () => {
  it("tracks opening stock and low stock; services never track stock", async () => {
    const gst18 = data(await biz.get("/tax-rates", undefined, 200)).find((rate) => rate.rate === "18.00");
    const rod = data(
      await biz.post(
        "/items",
        {
          name: "Steel rod",
          unit_code: "kgs",
          hsn_sac: "7214",
          sale_price: "65.5",
          tax_rate_id: gst18.id,
          opening_stock: "250.5",
          opening_stock_rate: 58,
          low_stock_threshold: 300,
        },
        201,
      ),
    );
    expect(rod).toMatchObject({
      unit_code: "KGS",
      track_stock: true,
      quantity_on_hand: "250.500",
      tax_rate: "18.00",
      opening_stock: "250.500",
      sale_price: "65.5000",
    });
    expect(data(await biz.get("/items", { low_stock: "true" }, 200)).map((i) => i.id)).toContain(rod.id);

    const service = data(await biz.post("/items", { name: "Installation", item_type: "service", track_stock: true }, 201));
    expect(service).toMatchObject({ track_stock: false, quantity_on_hand: null });

    expect((await biz.post("/items", { name: "Bad unit", unit_code: "k" })).status).toBe(400);
    expect((await biz.post("/items", { name: "Bad HSN", hsn_sac: "12" })).status).toBe(400);
    expect((await biz.post("/items", { name: "Bad price", sale_price: "1.234567" })).status).toBe(400);
  });
});

describe("accounts and categories", () => {
  it("supports overdraft opening balances and one default account per type", async () => {
    const od = data(
      await biz.post(
        "/accounts",
        { name: "HDFC OD", account_type: "bank", ifsc: "hdfc0000123", opening_balance: "-2000", is_default: true },
        201,
      ),
    );
    expect(od).toMatchObject({ balance: "-2000.00", ifsc: "HDFC0000123", is_default: true });

    const sbi = data(await biz.post("/accounts", { name: "SBI Savings", account_type: "bank", is_default: true }, 201));
    const defaults = data(await biz.get("/accounts", undefined, 200)).filter(
      (account) => account.account_type === "bank" && account.is_default,
    );
    expect(defaults.map((account) => account.id)).toEqual([sbi.id]);

    expect(data(await biz.patch(`/accounts/${od.id}`, { opening_balance: 500 }, 200)).balance).toBe("500.00");
  });

  it("keeps category names unique per business, ignoring case", async () => {
    const hardware = data(await biz.post("/item-categories", { name: "Hardware" }, 201));
    expect((await biz.post("/item-categories", { name: "hardware" })).status).toBe(409);

    await biz.post(`/item-categories/${hardware.id}/archive`, {}, 200);
    expect(data(await biz.get("/item-categories", undefined, 200)).map((c) => c.id)).not.toContain(hardware.id);
  });
});
