export const shorthands = undefined;

// A party can have several billing and several shipping addresses, with one
// default of each kind. An invoice still copies the chosen address onto
// itself — the copy is what was printed, and editing the party later must not
// change old bills — and also remembers which saved address it came from, so
// editing the bill shows the same choice.

export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE party_addresses (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      party_id    uuid NOT NULL,
      kind        text NOT NULL CHECK (kind IN ('billing', 'shipping')),
      label       text CHECK (length(btrim(label)) BETWEEN 1 AND 50),
      address     jsonb NOT NULL CHECK (jsonb_typeof(address) = 'object'),
      is_default  boolean NOT NULL DEFAULT false,
      position    integer NOT NULL DEFAULT 0,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, id),
      FOREIGN KEY (business_id, party_id) REFERENCES parties (business_id, id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX party_addresses_one_default
      ON party_addresses (party_id, kind) WHERE is_default;
    CREATE INDEX party_addresses_party_idx ON party_addresses (party_id, kind, position);
    CREATE TRIGGER party_addresses_set_updated_at BEFORE UPDATE ON party_addresses
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- Each party's single address becomes its default of that kind. Addresses
    -- saved with every field empty are dropped.
    INSERT INTO party_addresses (business_id, party_id, kind, address, is_default)
    SELECT business_id, id, 'billing', billing_address, true
    FROM parties
    WHERE jsonb_typeof(billing_address) = 'object'
      AND EXISTS (SELECT 1 FROM jsonb_each_text(billing_address) f WHERE btrim(coalesce(f.value, '')) <> '');

    INSERT INTO party_addresses (business_id, party_id, kind, address, is_default)
    SELECT business_id, id, 'shipping', shipping_address, true
    FROM parties
    WHERE jsonb_typeof(shipping_address) = 'object'
      AND EXISTS (SELECT 1 FROM jsonb_each_text(shipping_address) f WHERE btrim(coalesce(f.value, '')) <> '');

    ALTER TABLE parties DROP COLUMN billing_address, DROP COLUMN shipping_address;

    -- Which saved address a bill used. The address itself is copied into
    -- billing_address / shipping_address; these only point back to it.
    ALTER TABLE invoices
      ADD COLUMN billing_address_id  uuid REFERENCES party_addresses (id) ON DELETE SET NULL,
      ADD COLUMN shipping_address_id uuid REFERENCES party_addresses (id) ON DELETE SET NULL;
  `);
}

export async function down(pgm) {
  pgm.sql(`
    ALTER TABLE invoices DROP COLUMN billing_address_id, DROP COLUMN shipping_address_id;

    ALTER TABLE parties ADD COLUMN billing_address jsonb, ADD COLUMN shipping_address jsonb;
    UPDATE parties p SET billing_address = a.address
    FROM party_addresses a WHERE a.party_id = p.id AND a.kind = 'billing' AND a.is_default;
    UPDATE parties p SET shipping_address = a.address
    FROM party_addresses a WHERE a.party_id = p.id AND a.kind = 'shipping' AND a.is_default;

    DROP TABLE party_addresses;
  `);
}
