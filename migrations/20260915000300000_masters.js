export const shorthands = undefined;

const GSTIN = `'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`;
const STATE_CODE = `'^[0-9]{2}$'`;
const HSN_SAC = `'^[0-9]{4,8}$'`;

const updatedAt = (...tables) =>
  tables
    .map(
      (table) =>
        `CREATE TRIGGER ${table}_set_updated_at BEFORE UPDATE ON ${table}
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();`,
    )
    .join("\n");

// Every business-owned table exposes UNIQUE (business_id, id) so children can
// use composite foreign keys: a row can then only ever point at a party, item
// or account of its own business, whatever the application code does.
//
// Foreign keys between business-owned rows that do not cascade are
// DEFERRABLE (still checked immediately by default). Deleting a business
// cascades through rows that reference each other several levels deep, and
// Postgres would check "party still referenced" before the cascade reaches
// the referencing invoice charge. The business-delete routine therefore runs
// SET CONSTRAINTS ALL DEFERRED first; nothing else needs to.

export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE parties (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id      uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 255),
      party_type       text NOT NULL CHECK (party_type IN ('customer', 'supplier', 'both', 'transporter')),
      phone            text CHECK (length(phone) <= 20),
      email            citext,
      gst_type         text NOT NULL DEFAULT 'unregistered'
                       CHECK (gst_type IN ('registered', 'unregistered', 'composition', 'consumer', 'overseas')),
      gstin            varchar(15) CHECK (gstin ~ ${GSTIN}),
      state_code       char(2) CHECK (state_code ~ ${STATE_CODE}),
      billing_address  jsonb,
      shipping_address jsonb,
      credit_limit     numeric(15,2) CHECK (credit_limit >= 0),
      credit_days      integer CHECK (credit_days >= 0),
      notes            text,
      archived_at      timestamptz,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      -- The balance is not stored here; it is the sum of party_ledger_entries.
      UNIQUE (business_id, id),
      CONSTRAINT parties_gstin_required
        CHECK (gst_type NOT IN ('registered', 'composition') OR gstin IS NOT NULL),
      CONSTRAINT parties_gstin_matches_state
        CHECK (gstin IS NULL OR state_code IS NULL OR substr(gstin, 1, 2) = state_code)
    );
    CREATE UNIQUE INDEX parties_name_unique
      ON parties (business_id, lower(name)) WHERE archived_at IS NULL;
    CREATE INDEX parties_business_type_idx ON parties (business_id, party_type);

    CREATE TABLE tax_rates (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 50),
      rate        numeric(5,2) NOT NULL CHECK (rate BETWEEN 0 AND 100),
      cess_rate   numeric(5,2) NOT NULL DEFAULT 0 CHECK (cess_rate BETWEEN 0 AND 100),
      is_active   boolean NOT NULL DEFAULT true,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, id),
      UNIQUE (business_id, rate, cess_rate)
    );

    CREATE TABLE item_categories (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
      archived_at timestamptz,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, id)
    );
    CREATE UNIQUE INDEX item_categories_name_unique
      ON item_categories (business_id, lower(name)) WHERE archived_at IS NULL;

    CREATE TABLE items (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id         uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      category_id         uuid,
      name                text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 255),
      item_type           text NOT NULL DEFAULT 'goods' CHECK (item_type IN ('goods', 'service')),
      sku                 text CHECK (length(sku) <= 50),
      barcode             text CHECK (length(barcode) <= 50),
      hsn_sac             varchar(8) CHECK (hsn_sac ~ ${HSN_SAC}),
      -- GST unit quantity code (UQC), e.g. NOS, KGS, MTR, BOX.
      unit_code           varchar(10) NOT NULL DEFAULT 'NOS',
      sale_price          numeric(15,4) CHECK (sale_price >= 0),
      purchase_price      numeric(15,4) CHECK (purchase_price >= 0),
      price_includes_tax  boolean NOT NULL DEFAULT false,
      tax_rate_id         uuid,
      track_stock         boolean NOT NULL DEFAULT true,
      low_stock_threshold numeric(15,3) CHECK (low_stock_threshold >= 0),
      archived_at         timestamptz,
      created_at          timestamptz NOT NULL DEFAULT now(),
      updated_at          timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, id),
      FOREIGN KEY (business_id, category_id) REFERENCES item_categories (business_id, id) DEFERRABLE,
      FOREIGN KEY (business_id, tax_rate_id) REFERENCES tax_rates (business_id, id) DEFERRABLE,
      CONSTRAINT items_services_have_no_stock CHECK (item_type = 'goods' OR NOT track_stock)
    );
    CREATE UNIQUE INDEX items_name_unique
      ON items (business_id, lower(name)) WHERE archived_at IS NULL;
    CREATE UNIQUE INDEX items_sku_unique
      ON items (business_id, sku) WHERE sku IS NOT NULL AND archived_at IS NULL;
    CREATE UNIQUE INDEX items_barcode_unique
      ON items (business_id, barcode) WHERE barcode IS NOT NULL AND archived_at IS NULL;

    -- Cash in hand and bank accounts. Balances come from account_entries.
    CREATE TABLE accounts (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id    uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      name           text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
      account_type   text NOT NULL CHECK (account_type IN ('cash', 'bank')),
      bank_name      text,
      account_number text CHECK (length(account_number) <= 34),
      ifsc           varchar(11) CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
      upi_id         text CHECK (length(upi_id) <= 100),
      is_default     boolean NOT NULL DEFAULT false,
      archived_at    timestamptz,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, id)
    );
    CREATE UNIQUE INDEX accounts_name_unique
      ON accounts (business_id, lower(name)) WHERE archived_at IS NULL;
    CREATE UNIQUE INDEX accounts_one_default_per_type
      ON accounts (business_id, account_type) WHERE is_default AND archived_at IS NULL;

    CREATE TABLE expense_categories (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
      archived_at timestamptz,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, id)
    );
    CREATE UNIQUE INDEX expense_categories_name_unique
      ON expense_categories (business_id, lower(name)) WHERE archived_at IS NULL;

    ${updatedAt("parties", "tax_rates", "item_categories", "items", "accounts", "expense_categories")}
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DROP TABLE expense_categories;
    DROP TABLE accounts;
    DROP TABLE items;
    DROP TABLE item_categories;
    DROP TABLE tax_rates;
    DROP TABLE parties;
  `);
}
