import { afterAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { app, bizClient, closeDb, createBusiness, data, signup } from "./helpers.js";

afterAll(closeDb);

describe("businesses", () => {
  it("creates a GST business with a cash account, bank account, GST rates and expense categories", async () => {
    const owner = await signup();
    const business = await createBusiness(owner.auth, {
      bank_account: { name: "HDFC Current", ifsc: "hdfc0001234", opening_balance: "5000.50" },
    });
    expect(business).toMatchObject({ role: "owner", gstin: "24ABCDE1234F1Z5", state_code: "24" });
    expect(business.settings.round_off_invoices).toBe(true);

    const biz = bizClient(owner.auth, business.id);
    const accounts = data(await biz.get("/accounts", undefined, 200));
    expect(accounts.map((a) => [a.name, a.account_type, a.balance, a.is_default])).toEqual([
      ["Cash in hand", "cash", "10000.00", true],
      ["HDFC Current", "bank", "5000.50", true],
    ]);

    const rates = data(await biz.get("/tax-rates", undefined, 200)).map((rate) => rate.rate);
    expect(rates).toEqual(expect.arrayContaining(["0.00", "5.00", "18.00", "40.00"]));

    const categories = data(await biz.get("/expense-categories", undefined, 200)).map((c) => c.name);
    expect(categories).toContain("Rent");
  });

  it("validates GST registration details", async () => {
    const owner = await signup();
    const post = (body) => request(app).post("/v1/businesses").set(owner.auth).send(body);

    expect((await post({ name: "No GSTIN", gst_registration_type: "regular", state_code: "24" })).status).toBe(400);
    expect(
      (await post({ name: "Wrong state", gst_registration_type: "regular", gstin: "24ABCDE1234F1Z5", state_code: "27" }))
        .status,
    ).toBe(400);
    expect((await post({ name: "Small shop", state_code: "27" })).status).toBe(201);
  });

  it("lets owners and admins edit settings but hides the business from outsiders", async () => {
    const owner = await signup();
    const business = await createBusiness(owner.auth);
    const biz = bizClient(owner.auth, business.id);

    const updated = data(
      await biz.patch("", { phone: "9876543210", settings: { invoice_terms: "Goods once sold are not taken back" } }, 200),
    );
    expect(updated.phone).toBe("9876543210");
    expect(updated.settings).toMatchObject({ round_off_invoices: true, invoice_terms: "Goods once sold are not taken back" });

    const stranger = await signup();
    expect((await request(app).get(`/v1/businesses/${business.id}`).set(stranger.auth)).status).toBe(404);
    expect((await request(app).get("/v1/businesses/not-a-uuid").set(owner.auth)).status).toBe(404);
    expect(data(await request(app).get("/v1/businesses").set(stranger.auth))).toEqual([]);
  });

  it("invites a member whose role limits what they can do", async () => {
    const owner = await signup();
    const business = await createBusiness(owner.auth);
    const ownerBiz = bizClient(owner.auth, business.id);
    const staff = await signup();
    const someoneElse = await signup();

    const invite = data(await ownerBiz.post("/invites", { email: staff.user.email, role: "staff" }, 201));
    expect(invite.invite_token).toBeTruthy();

    const accept = (who) => request(app).post("/v1/invites/accept").set(who.auth).send({ token: invite.invite_token });
    expect((await accept(someoneElse)).status).toBe(403);
    expect(data(await accept(staff))).toMatchObject({ id: business.id, role: "staff" });
    expect((await accept(staff)).status).toBe(404);

    const staffBiz = bizClient(staff.auth, business.id);
    expect((await staffBiz.get("")).status).toBe(200);
    expect((await staffBiz.patch("", { name: "Hijacked" })).status).toBe(403);
    expect((await staffBiz.post("/invites", { email: someoneElse.user.email, role: "staff" })).status).toBe(403);
    expect((await staffBiz.get("/reports/dashboard")).status).toBe(403);
    expect((await staffBiz.post("/parties", { name: "Walk-in Ramesh", party_type: "customer" })).status).toBe(201);
    expect(
      (await staffBiz.post("/parties", { name: "With opening", party_type: "customer", opening_balance: 10 })).status,
    ).toBe(403);

    await ownerBiz.patch(`/members/${staff.user.id}`, { role: "accountant" }, 200);
    expect((await staffBiz.get("/reports/dashboard")).status).toBe(200);
    expect(data(await ownerBiz.get("/members", undefined, 200)).map((m) => m.role)).toEqual(["owner", "accountant"]);
    expect((await ownerBiz.patch(`/members/${owner.user.id}`, { role: "admin" })).status).toBe(403);

    await ownerBiz.del(`/members/${staff.user.id}`, undefined, 200);
    expect((await staffBiz.get("")).status).toBe(404);
  });

  it("accepts the logo and signature as image data URIs or URLs", async () => {
    const owner = await signup();
    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
    const business = await createBusiness(owner.auth, { logo_url: pixel, signature_url: "https://example.com/sign.png" });
    expect(business.logo_url).toBe(pixel);

    const biz = bizClient(owner.auth, business.id);
    expect((await biz.patch("", { logo_url: "data:text/html;base64,PHNjcmlwdD4=" })).status).toBe(400);
    expect((await biz.patch("", { signature_url: "not an image" })).status).toBe(400);
    expect(data(await biz.patch("", { logo_url: null }, 200)).logo_url).toBeNull();
  });

  it("archives a business, owner only", async () => {
    const owner = await signup();
    const business = await createBusiness(owner.auth);
    const biz = bizClient(owner.auth, business.id);

    await biz.del("", undefined, 200);
    expect((await biz.get("")).status).toBe(404);
    expect(data(await request(app).get("/v1/businesses").set(owner.auth)).map((b) => b.id)).not.toContain(business.id);
  });
});
