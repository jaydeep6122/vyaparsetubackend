export const shorthands = undefined;

// The three ledgers are the only source of truth for balances and stock.
// They are written exclusively by the posting service, which deletes and
// rewrites a document's rows (by source_type + source_id) in the same
// transaction that creates, edits or cancels the document.
//
// business_id cascades from businesses directly; the party/account/item keys
// do not cascade (DEFERRABLE, see the masters migration), so a master row
// with history cannot be deleted on its own.

export async function up(pgm) {
  pgm.sql(`
    -- debit = the party owes the business more (sale, payment out, purchase
    -- return); credit = the business owes the party more (purchase, payment
    -- in, sale return, freight owed to a transporter).
    CREATE TABLE party_ledger_entries (
      id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      party_id    uuid NOT NULL,
      entry_date  date NOT NULL,
      source_type text NOT NULL
                  CHECK (source_type IN ('opening', 'invoice', 'invoice_charge', 'payment', 'expense', 'adjustment')),
      source_id   uuid NOT NULL,
      debit       numeric(15,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
      credit      numeric(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
      narration   text,
      created_at  timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (business_id, party_id) REFERENCES parties (business_id, id) DEFERRABLE,
      CONSTRAINT party_ledger_entries_one_side CHECK ((debit = 0) <> (credit = 0))
    );
    CREATE INDEX party_ledger_entries_party_date_idx ON party_ledger_entries (business_id, party_id, entry_date);
    CREATE INDEX party_ledger_entries_source_idx ON party_ledger_entries (source_type, source_id);

    -- amount > 0 is money in, < 0 is money out.
    CREATE TABLE account_entries (
      id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      account_id  uuid NOT NULL,
      entry_date  date NOT NULL,
      amount      numeric(15,2) NOT NULL CHECK (amount <> 0),
      source_type text NOT NULL CHECK (source_type IN ('opening', 'payment', 'transfer')),
      source_id   uuid NOT NULL,
      narration   text,
      created_at  timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (business_id, account_id) REFERENCES accounts (business_id, id) DEFERRABLE
    );
    CREATE INDEX account_entries_account_date_idx ON account_entries (business_id, account_id, entry_date);
    CREATE INDEX account_entries_source_idx ON account_entries (source_type, source_id);

    -- quantity > 0 is stock in, < 0 is stock out.
    CREATE TABLE stock_movements (
      id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      business_id    uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      item_id        uuid NOT NULL,
      movement_date  date NOT NULL,
      quantity       numeric(15,3) NOT NULL CHECK (quantity <> 0),
      unit_cost      numeric(15,4) CHECK (unit_cost >= 0),
      source_type    text NOT NULL CHECK (source_type IN ('opening', 'invoice', 'adjustment')),
      source_id      uuid NOT NULL,
      source_line_id uuid,
      created_at     timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (business_id, item_id) REFERENCES items (business_id, id) DEFERRABLE
    );
    CREATE INDEX stock_movements_item_date_idx ON stock_movements (business_id, item_id, movement_date);
    CREATE INDEX stock_movements_source_idx ON stock_movements (source_type, source_id);
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DROP TABLE stock_movements;
    DROP TABLE account_entries;
    DROP TABLE party_ledger_entries;
  `);
}
