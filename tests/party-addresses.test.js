import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { bizClient, closeDb, createBusiness, data, signup } from "./helpers.js";

// Parties keep several billing and shipping addresses. A bill copies the one
// picked, so later edits to the party never change what was printed.

let biz;
let item;
let seq = 0;

const place = (line1, city = "Rajkot") => ({ line1, city, state: "Gujarat", pincode: "360001" });

const newCustomer = async (extra = {}) =>
  data(await biz.post("/parties", { name: `Address customer ${++seq}`, party_type: "customer", ...extra }, 201));

const sale = (party, extra = {}, status = 201) =>
  biz.post(
    "/invoices",
    { invoice_type: "sale", tax_mode: "non_gst", party_id: party.id, lines: [{ item_id: item.id, quantity: 1 }], ...extra },
    status,
  );

const ofKind = (party, kind) => party.addresses.filter((entry) => entry.kind === kind);

beforeAll(async () => {
  const owner = await signup();
  const business = await createBusiness(owner.auth);
  biz = bizClient(owner.auth, business.id);
  item = data(await biz.post("/items", { name: "Tiles box", sale_price: 1000 }, 201));
});

afterAll(closeDb);

describe("saving a party's addresses", () => {
  it("keeps several of each kind with one default, defaults listed first", async () => {
    const party = await newCustomer({
      addresses: [
        { kind: "billing", label: "Head office", address: place("1 Main Road") },
        { kind: "billing", label: "Branch", address: place("9 Ring Road"), is_default: true },
        { kind: "shipping", label: "Warehouse", address: place("Plot 4 GIDC") },
        { kind: "shipping", label: "Site", address: place("Survey 12", "Morbi") },
      ],
    });

    expect(party.addresses).toHaveLength(4);
    expect(ofKind(party, "billing").map((a) => [a.label, a.is_default])).toEqual([
      ["Branch", true],
      ["Head office", false],
    ]);
    // With no default marked, the first of the kind becomes the default.
    expect(ofKind(party, "shipping").map((a) => [a.label, a.is_default])).toEqual([
      ["Warehouse", true],
      ["Site", false],
    ]);
    // The single-address fields are the defaults, for older clients.
    expect(party.billing_address.line1).toBe("9 Ring Road");
    expect(party.shipping_address.line1).toBe("Plot 4 GIDC");
  });

  it("rejects two defaults of one kind and empty addresses", async () => {
    const twoDefaults = await biz.post("/parties", {
      name: "Two defaults",
      party_type: "customer",
      addresses: [
        { kind: "billing", address: place("A"), is_default: true },
        { kind: "billing", address: place("B"), is_default: true },
      ],
    });
    expect(twoDefaults.status).toBe(400);

    const empty = await biz.post("/parties", {
      name: "Empty address",
      party_type: "customer",
      addresses: [{ kind: "shipping", address: { line1: "", city: null } }],
    });
    expect(empty.status).toBe(400);
  });

  it("replaces the set: kept ids stay, missing ones go, new ones are added", async () => {
    const party = await newCustomer({
      addresses: [
        { kind: "billing", label: "Old office", address: place("1 Old Street") },
        { kind: "shipping", label: "Godown", address: place("2 Godown Lane") },
      ],
    });
    const [office] = ofKind(party, "billing");

    const updated = data(
      await biz.patch(
        `/parties/${party.id}`,
        {
          addresses: [
            { id: office.id, kind: "billing", label: "Main office", address: place("1 Old Street") },
            { kind: "billing", label: "New branch", address: place("5 New Road"), is_default: true },
          ],
        },
        200,
      ),
    );

    const billing = ofKind(updated, "billing");
    expect(billing.map((a) => [a.label, a.is_default])).toEqual([
      ["New branch", true],
      ["Main office", false],
    ]);
    expect(billing.find((a) => a.label === "Main office").id).toBe(office.id);
    expect(ofKind(updated, "shipping")).toHaveLength(0);
    expect(updated.shipping_address).toBeNull();
  });

  it("refuses an address that belongs to another party", async () => {
    const other = await newCustomer({ addresses: [{ kind: "billing", address: place("Elsewhere") }] });
    const party = await newCustomer();

    const res = await biz.patch(`/parties/${party.id}`, {
      addresses: [{ id: other.addresses[0].id, kind: "billing", address: place("Taken") }],
    });
    expect(res.status).toBe(400);
  });

  it("still accepts the single billing and shipping address older apps send", async () => {
    const party = await newCustomer({ billing_address: place("Legacy billing") });
    expect(ofKind(party, "billing")).toHaveLength(1);
    expect(party.billing_address.line1).toBe("Legacy billing");

    // Editing it changes the default in place.
    const edited = data(
      await biz.patch(`/parties/${party.id}`, { billing_address: place("Legacy billing, moved") }, 200),
    );
    expect(edited.addresses[0].id).toBe(party.addresses[0].id);
    expect(edited.billing_address.line1).toBe("Legacy billing, moved");

    // "Same as billing" (null) removes a lone shipping address...
    await biz.patch(`/parties/${party.id}`, { shipping_address: place("Lone shipping") }, 200);
    const cleared = data(await biz.patch(`/parties/${party.id}`, { shipping_address: null }, 200));
    expect(ofKind(cleared, "shipping")).toHaveLength(0);

    // ...but never wipes several addresses added from a newer app.
    await biz.patch(
      `/parties/${party.id}`,
      {
        addresses: [
          { kind: "billing", address: place("Legacy billing, moved") },
          { kind: "shipping", address: place("Ship one") },
          { kind: "shipping", address: place("Ship two") },
        ],
      },
      200,
    );
    const kept = data(await biz.patch(`/parties/${party.id}`, { shipping_address: null }, 200));
    expect(ofKind(kept, "shipping")).toHaveLength(2);
  });
});

describe("addresses on bills", () => {
  it("prints the addresses picked for the bill and remembers which they were", async () => {
    const party = await newCustomer({
      addresses: [
        { kind: "billing", label: "Head office", address: place("1 Main Road") },
        { kind: "billing", label: "Branch", address: place("9 Ring Road") },
        { kind: "shipping", label: "Warehouse", address: place("Plot 4 GIDC") },
        { kind: "shipping", label: "Site", address: place("Survey 12", "Morbi") },
      ],
    });
    const branch = ofKind(party, "billing").find((a) => a.label === "Branch");
    const site = ofKind(party, "shipping").find((a) => a.label === "Site");

    const invoice = data(await sale(party, { billing_address_id: branch.id, shipping_address_id: site.id }));
    expect(invoice.billing_address_id).toBe(branch.id);
    expect(invoice.shipping_address_id).toBe(site.id);
    expect(invoice.billing_address.line1).toBe("9 Ring Road");
    expect(invoice.shipping_address).toMatchObject({ line1: "Survey 12", city: "Morbi" });
  });

  it("uses the party's defaults when nothing is picked", async () => {
    const party = await newCustomer({
      addresses: [
        { kind: "billing", address: place("Default billing") },
        { kind: "shipping", address: place("Default shipping") },
      ],
    });
    const invoice = data(await sale(party));
    expect(invoice.billing_address.line1).toBe("Default billing");
    expect(invoice.shipping_address.line1).toBe("Default shipping");
    expect(invoice.billing_address_id).toBe(ofKind(party, "billing")[0].id);
  });

  it("allows shipping to a billing address, but not to another party's address", async () => {
    const party = await newCustomer({ addresses: [{ kind: "billing", address: place("Office and godown") }] });
    const invoice = data(
      await sale(party, { billing_address_id: party.addresses[0].id, shipping_address_id: party.addresses[0].id }),
    );
    expect(invoice.shipping_address.line1).toBe("Office and godown");

    const stranger = await newCustomer({ addresses: [{ kind: "shipping", address: place("Not theirs") }] });
    const res = await biz.post("/invoices", {
      invoice_type: "sale",
      tax_mode: "non_gst",
      party_id: party.id,
      shipping_address_id: stranger.addresses[0].id,
      lines: [{ item_id: item.id, quantity: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("does not belong to this party");
  });

  it("keeps the printed address when the party's address changes or the bill is edited", async () => {
    const party = await newCustomer({ addresses: [{ kind: "billing", label: "Office", address: place("Before move") }] });
    const office = party.addresses[0];
    const invoice = data(await sale(party, { billing_address_id: office.id }));

    await biz.patch(
      `/parties/${party.id}`,
      { addresses: [{ id: office.id, kind: "billing", label: "Office", address: place("After move") }] },
      200,
    );
    const reread = data(await biz.get(`/invoices/${invoice.id}`, undefined, 200));
    expect(reread.billing_address.line1).toBe("Before move");

    // A full replace that says nothing about addresses keeps the bill's own.
    const replaced = data(
      await biz.put(
        `/invoices/${invoice.id}`,
        {
          invoice_type: "sale",
          tax_mode: "non_gst",
          party_id: party.id,
          lines: [{ item_id: item.id, quantity: 2 }],
        },
        200,
      ),
    );
    expect(replaced.billing_address.line1).toBe("Before move");
    expect(replaced.billing_address_id).toBe(office.id);
  });
});
