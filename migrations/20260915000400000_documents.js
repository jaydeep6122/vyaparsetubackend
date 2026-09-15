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

export async function up(pgm) {
  pgm.sql(`
    -- Gap-free document numbers per business, type and financial year. The
    -- next number is taken with SELECT ... FOR UPDATE inside the document's
    -- own transaction.
    CREATE TABLE document_series (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id    uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      doc_type       text NOT NULL CHECK (doc_type IN (
                       'sale', 'sale_non_gst', 'purchase', 'purchase_non_gst',
                       'sale_return', 'purchase_return', 'payment_in', 'payment_out', 'expense')),
      financial_year varchar(7) NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
      prefix         text NOT NULL DEFAULT '' CHECK (length(prefix) <= 20),
      next_number    integer NOT NULL DEFAULT 1 CHECK (next_number >= 1),
      padding        smallint NOT NULL DEFAULT 1 CHECK (padding BETWEEN 1 AND 10),
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, doc_type, financial_year)
    );

    CREATE TABLE invoices (
      id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id             uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      invoice_type            text NOT NULL CHECK (invoice_type IN ('sale', 'purchase', 'sale_return', 'purchase_return')),
      -- gst = tax invoice; non_gst = bill of supply / cash memo.
      tax_mode                text NOT NULL DEFAULT 'gst' CHECK (tax_mode IN ('gst', 'non_gst')),
      status                  text NOT NULL DEFAULT 'final' CHECK (status IN ('draft', 'final', 'cancelled')),
      invoice_number          text NOT NULL CHECK (length(btrim(invoice_number)) BETWEEN 1 AND 50),
      invoice_date            date NOT NULL,
      due_date                date,
      supplier_invoice_number text CHECK (length(supplier_invoice_number) <= 50),
      supplier_invoice_date   date,

      -- NULL party = walk-in cash sale. The snapshot keeps the printed bill
      -- unchanged if the party is edited later.
      party_id                uuid,
      party_name              text NOT NULL CHECK (length(btrim(party_name)) BETWEEN 1 AND 255),
      party_gstin             varchar(15) CHECK (party_gstin ~ ${GSTIN}),
      party_state_code        char(2) CHECK (party_state_code ~ ${STATE_CODE}),
      billing_address         jsonb,
      shipping_address        jsonb,

      place_of_supply         char(2) CHECK (place_of_supply ~ ${STATE_CODE}),
      supply_type             text CHECK (supply_type IN ('intra', 'inter')),
      is_reverse_charge       boolean NOT NULL DEFAULT false,
      original_invoice_id     uuid,
      price_includes_tax      boolean NOT NULL DEFAULT false,

      taxable_total           numeric(15,2) NOT NULL DEFAULT 0 CHECK (taxable_total >= 0),
      discount_total          numeric(15,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
      cgst_total              numeric(15,2) NOT NULL DEFAULT 0 CHECK (cgst_total >= 0),
      sgst_total              numeric(15,2) NOT NULL DEFAULT 0 CHECK (sgst_total >= 0),
      igst_total              numeric(15,2) NOT NULL DEFAULT 0 CHECK (igst_total >= 0),
      cess_total              numeric(15,2) NOT NULL DEFAULT 0 CHECK (cess_total >= 0),
      -- Charges billed to the invoice party (incl. their tax); payee-only
      -- charges such as a separately owed transporter are not part of it.
      charges_total           numeric(15,2) NOT NULL DEFAULT 0 CHECK (charges_total >= 0),
      round_off               numeric(4,2) NOT NULL DEFAULT 0 CHECK (round_off BETWEEN -0.99 AND 0.99),
      total_amount            numeric(15,2) NOT NULL CHECK (total_amount >= 0),
      -- Maintained by the payment_allocations trigger; never written directly.
      amount_settled          numeric(15,2) NOT NULL DEFAULT 0,
      payment_status          text GENERATED ALWAYS AS (
                                CASE
                                  WHEN amount_settled >= total_amount THEN 'paid'
                                  WHEN amount_settled > 0 THEN 'partially_paid'
                                  ELSE 'unpaid'
                                END) STORED,

      -- Transport & delivery
      vehicle_no              varchar(20),
      driver_name             text CHECK (length(driver_name) <= 100),
      driver_phone            varchar(20),
      transport_mode          text CHECK (transport_mode IN ('road', 'rail', 'air', 'ship', 'self')),
      lr_no                   text CHECK (length(lr_no) <= 50),
      lr_date                 date,
      eway_bill_no            varchar(20),
      eway_bill_date          date,
      chalan_no               text CHECK (length(chalan_no) <= 50),
      delivery_date           date,
      dispatch_from           jsonb,
      ship_to                 jsonb,

      notes                   text,
      terms                   text,
      created_by              uuid REFERENCES users (id) ON DELETE SET NULL,
      cancelled_at            timestamptz,
      cancel_reason           text,
      created_at              timestamptz NOT NULL DEFAULT now(),
      updated_at              timestamptz NOT NULL DEFAULT now(),

      UNIQUE (business_id, id),
      UNIQUE (business_id, id, tax_mode),
      -- Cancelled bills keep their number; numbers are never reused.
      CONSTRAINT invoices_number_unique UNIQUE (business_id, invoice_type, tax_mode, invoice_number),
      FOREIGN KEY (business_id, party_id) REFERENCES parties (business_id, id) DEFERRABLE,

      CONSTRAINT invoices_total_adds_up CHECK (
        total_amount = taxable_total + cgst_total + sgst_total + igst_total + cess_total
                       + charges_total + round_off),
      CONSTRAINT invoices_settled_within_total CHECK (amount_settled BETWEEN 0 AND total_amount),
      CONSTRAINT invoices_due_after_invoice CHECK (due_date IS NULL OR due_date >= invoice_date),
      CONSTRAINT invoices_non_gst_has_no_tax CHECK (
        tax_mode = 'gst'
        OR (cgst_total = 0 AND sgst_total = 0 AND igst_total = 0 AND cess_total = 0
            AND supply_type IS NULL AND NOT is_reverse_charge)),
      CONSTRAINT invoices_gst_has_place_of_supply CHECK (
        tax_mode = 'non_gst' OR (place_of_supply IS NOT NULL AND supply_type IS NOT NULL)),
      CONSTRAINT invoices_intra_state_has_no_igst CHECK (supply_type IS DISTINCT FROM 'intra' OR igst_total = 0),
      CONSTRAINT invoices_inter_state_has_no_cgst_sgst CHECK (
        supply_type IS DISTINCT FROM 'inter' OR (cgst_total = 0 AND sgst_total = 0)),
      CONSTRAINT invoices_only_returns_reference_original CHECK (
        original_invoice_id IS NULL OR invoice_type IN ('sale_return', 'purchase_return')),
      CONSTRAINT invoices_supplier_number_on_purchases CHECK (
        supplier_invoice_number IS NULL OR invoice_type = 'purchase'),
      CONSTRAINT invoices_cancelled_consistent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
      CONSTRAINT invoices_cancelled_unsettled CHECK (status <> 'cancelled' OR amount_settled = 0)
    );
    ALTER TABLE invoices ADD FOREIGN KEY (business_id, original_invoice_id)
      REFERENCES invoices (business_id, id) DEFERRABLE;
    CREATE UNIQUE INDEX invoices_supplier_number_unique
      ON invoices (business_id, party_id, supplier_invoice_number)
      WHERE supplier_invoice_number IS NOT NULL AND status <> 'cancelled';
    CREATE INDEX invoices_business_type_date_idx ON invoices (business_id, invoice_type, invoice_date);
    CREATE INDEX invoices_business_party_idx ON invoices (business_id, party_id);
    CREATE INDEX invoices_business_status_due_idx ON invoices (business_id, status, due_date);
    CREATE INDEX invoices_original_invoice_idx ON invoices (original_invoice_id) WHERE original_invoice_id IS NOT NULL;

    CREATE TABLE invoice_lines (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id     uuid NOT NULL,
      invoice_id      uuid NOT NULL,
      -- Copied from the invoice (and cascaded on change) so the non-GST rule
      -- can be checked per line.
      tax_mode        text NOT NULL,
      line_no         smallint NOT NULL CHECK (line_no >= 1),
      item_id         uuid,
      description     text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
      hsn_sac         varchar(8) CHECK (hsn_sac ~ ${HSN_SAC}),
      quantity        numeric(15,3) NOT NULL CHECK (quantity > 0),
      unit_code       varchar(10),
      unit_price      numeric(15,4) NOT NULL CHECK (unit_price >= 0),
      discount_pct    numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
      discount_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
      taxable_value   numeric(15,2) NOT NULL CHECK (taxable_value >= 0),
      tax_rate        numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
      cess_rate       numeric(5,2) NOT NULL DEFAULT 0 CHECK (cess_rate BETWEEN 0 AND 100),
      cgst_amount     numeric(15,2) NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0),
      sgst_amount     numeric(15,2) NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0),
      igst_amount     numeric(15,2) NOT NULL DEFAULT 0 CHECK (igst_amount >= 0),
      cess_amount     numeric(15,2) NOT NULL DEFAULT 0 CHECK (cess_amount >= 0),
      line_total      numeric(15,2) NOT NULL CHECK (line_total >= 0),
      created_at      timestamptz NOT NULL DEFAULT now(),
      UNIQUE (invoice_id, line_no),
      FOREIGN KEY (business_id, invoice_id, tax_mode) REFERENCES invoices (business_id, id, tax_mode)
        ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY (business_id, item_id) REFERENCES items (business_id, id) DEFERRABLE,
      CONSTRAINT invoice_lines_total_adds_up CHECK (
        line_total = taxable_value + cgst_amount + sgst_amount + igst_amount + cess_amount),
      CONSTRAINT invoice_lines_non_gst_has_no_tax CHECK (
        tax_mode = 'gst'
        OR (tax_rate = 0 AND cess_rate = 0 AND cgst_amount = 0 AND sgst_amount = 0
            AND igst_amount = 0 AND cess_amount = 0))
    );
    CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id);
    CREATE INDEX invoice_lines_business_item_idx ON invoice_lines (business_id, item_id) WHERE item_id IS NOT NULL;

    -- Freight, loading, packing... Several per invoice.
    --   bill_to = 'invoice_party': part of the invoice total. A payee may also
    --     be set when a transporter must be paid for a charge recovered from
    --     the customer.
    --   bill_to = 'payee_only': owed only to the payee (e.g. freight on a
    --     purchase owed to the transporter, not the supplier).
    CREATE TABLE invoice_charges (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id    uuid NOT NULL,
      invoice_id     uuid NOT NULL,
      tax_mode       text NOT NULL,
      charge_type    text NOT NULL CHECK (charge_type IN ('transport', 'loading', 'unloading', 'packing', 'other')),
      description    text CHECK (length(description) <= 255),
      bill_to        text NOT NULL DEFAULT 'invoice_party' CHECK (bill_to IN ('invoice_party', 'payee_only')),
      payee_party_id uuid,
      vehicle_no     varchar(20),
      qty            numeric(15,3) CHECK (qty > 0),
      rate           numeric(15,4) CHECK (rate >= 0),
      amount         numeric(15,2) NOT NULL CHECK (amount >= 0),
      tax_rate       numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
      tax_amount     numeric(15,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
      -- What has been paid to the payee; maintained by the allocations trigger.
      amount_settled numeric(15,2) NOT NULL DEFAULT 0,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, id),
      FOREIGN KEY (business_id, invoice_id, tax_mode) REFERENCES invoices (business_id, id, tax_mode)
        ON DELETE CASCADE ON UPDATE CASCADE,
      FOREIGN KEY (business_id, payee_party_id) REFERENCES parties (business_id, id) DEFERRABLE,
      CONSTRAINT invoice_charges_qty_and_rate_together CHECK ((qty IS NULL) = (rate IS NULL)),
      CONSTRAINT invoice_charges_payee_only_needs_payee CHECK (bill_to = 'invoice_party' OR payee_party_id IS NOT NULL),
      CONSTRAINT invoice_charges_non_gst_has_no_tax CHECK (tax_mode = 'gst' OR (tax_rate = 0 AND tax_amount = 0)),
      CONSTRAINT invoice_charges_settled_needs_payee CHECK (payee_party_id IS NOT NULL OR amount_settled = 0),
      CONSTRAINT invoice_charges_settled_within_amount CHECK (amount_settled BETWEEN 0 AND amount + tax_amount)
    );
    CREATE INDEX invoice_charges_invoice_idx ON invoice_charges (invoice_id);
    CREATE INDEX invoice_charges_payee_idx ON invoice_charges (business_id, payee_party_id) WHERE payee_party_id IS NOT NULL;

    CREATE TABLE expenses (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id    uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      expense_number text NOT NULL CHECK (length(btrim(expense_number)) BETWEEN 1 AND 50),
      expense_date   date NOT NULL,
      category_id    uuid,
      party_id       uuid,
      tax_mode       text NOT NULL DEFAULT 'non_gst' CHECK (tax_mode IN ('gst', 'non_gst')),
      taxable_amount numeric(15,2) NOT NULL CHECK (taxable_amount >= 0),
      cgst_amount    numeric(15,2) NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0),
      sgst_amount    numeric(15,2) NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0),
      igst_amount    numeric(15,2) NOT NULL DEFAULT 0 CHECK (igst_amount >= 0),
      cess_amount    numeric(15,2) NOT NULL DEFAULT 0 CHECK (cess_amount >= 0),
      itc_eligible   boolean NOT NULL DEFAULT false,
      total_amount   numeric(15,2) NOT NULL CHECK (total_amount >= 0),
      amount_settled numeric(15,2) NOT NULL DEFAULT 0,
      payment_status text GENERATED ALWAYS AS (
                       CASE
                         WHEN amount_settled >= total_amount THEN 'paid'
                         WHEN amount_settled > 0 THEN 'partially_paid'
                         ELSE 'unpaid'
                       END) STORED,
      status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
      notes          text,
      created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
      cancelled_at   timestamptz,
      cancel_reason  text,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, id),
      CONSTRAINT expenses_number_unique UNIQUE (business_id, expense_number),
      FOREIGN KEY (business_id, category_id) REFERENCES expense_categories (business_id, id) DEFERRABLE,
      FOREIGN KEY (business_id, party_id) REFERENCES parties (business_id, id) DEFERRABLE,
      CONSTRAINT expenses_total_adds_up CHECK (
        total_amount = taxable_amount + cgst_amount + sgst_amount + igst_amount + cess_amount),
      CONSTRAINT expenses_settled_within_total CHECK (amount_settled BETWEEN 0 AND total_amount),
      CONSTRAINT expenses_non_gst_has_no_tax CHECK (
        tax_mode = 'gst'
        OR (cgst_amount = 0 AND sgst_amount = 0 AND igst_amount = 0 AND cess_amount = 0 AND NOT itc_eligible)),
      CONSTRAINT expenses_cancelled_consistent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
      CONSTRAINT expenses_cancelled_unsettled CHECK (status <> 'cancelled' OR amount_settled = 0)
    );
    CREATE INDEX expenses_business_date_idx ON expenses (business_id, expense_date);

    CREATE TABLE payments (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id      uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      payment_type     text NOT NULL CHECK (payment_type IN ('in', 'out')),
      payment_number   text NOT NULL CHECK (length(btrim(payment_number)) BETWEEN 1 AND 50),
      payment_date     date NOT NULL,
      -- NULL only for walk-in sales and expenses without a vendor.
      party_id         uuid,
      account_id       uuid NOT NULL,
      mode             text NOT NULL CHECK (mode IN ('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other')),
      amount           numeric(15,2) NOT NULL CHECK (amount > 0),
      -- Maintained by the allocations trigger; the rest is an advance.
      amount_allocated numeric(15,2) NOT NULL DEFAULT 0,
      unallocated_amount numeric(15,2) GENERATED ALWAYS AS (amount - amount_allocated) STORED,
      reference_no     text CHECK (length(reference_no) <= 100),
      cheque_no        text CHECK (length(cheque_no) <= 20),
      cheque_date      date,
      status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
      notes            text,
      created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
      cancelled_at     timestamptz,
      cancel_reason    text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, id),
      CONSTRAINT payments_number_unique UNIQUE (business_id, payment_type, payment_number),
      FOREIGN KEY (business_id, party_id) REFERENCES parties (business_id, id) DEFERRABLE,
      FOREIGN KEY (business_id, account_id) REFERENCES accounts (business_id, id) DEFERRABLE,
      CONSTRAINT payments_allocated_within_amount CHECK (amount_allocated BETWEEN 0 AND amount),
      CONSTRAINT payments_cheque_fields CHECK (mode = 'cheque' OR (cheque_no IS NULL AND cheque_date IS NULL)),
      CONSTRAINT payments_cancelled_consistent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
      CONSTRAINT payments_cancelled_unallocated CHECK (status <> 'cancelled' OR amount_allocated = 0)
    );
    CREATE INDEX payments_business_date_idx ON payments (business_id, payment_date);
    CREATE INDEX payments_business_party_idx ON payments (business_id, party_id);

    -- Links a payment to what it settles: exactly one invoice, payee charge or
    -- expense per row. One payment may settle several documents.
    CREATE TABLE payment_allocations (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id       uuid NOT NULL,
      payment_id        uuid NOT NULL,
      invoice_id        uuid,
      invoice_charge_id uuid,
      expense_id        uuid,
      amount            numeric(15,2) NOT NULL CHECK (amount > 0),
      created_at        timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (business_id, payment_id) REFERENCES payments (business_id, id) ON DELETE CASCADE,
      FOREIGN KEY (business_id, invoice_id) REFERENCES invoices (business_id, id) DEFERRABLE,
      FOREIGN KEY (business_id, invoice_charge_id) REFERENCES invoice_charges (business_id, id) DEFERRABLE,
      FOREIGN KEY (business_id, expense_id) REFERENCES expenses (business_id, id) DEFERRABLE,
      CONSTRAINT payment_allocations_one_target CHECK (num_nonnulls(invoice_id, invoice_charge_id, expense_id) = 1)
    );
    CREATE UNIQUE INDEX payment_allocations_invoice_unique
      ON payment_allocations (payment_id, invoice_id) WHERE invoice_id IS NOT NULL;
    CREATE UNIQUE INDEX payment_allocations_charge_unique
      ON payment_allocations (payment_id, invoice_charge_id) WHERE invoice_charge_id IS NOT NULL;
    CREATE UNIQUE INDEX payment_allocations_expense_unique
      ON payment_allocations (payment_id, expense_id) WHERE expense_id IS NOT NULL;
    CREATE INDEX payment_allocations_invoice_idx ON payment_allocations (invoice_id) WHERE invoice_id IS NOT NULL;
    CREATE INDEX payment_allocations_charge_idx ON payment_allocations (invoice_charge_id) WHERE invoice_charge_id IS NOT NULL;
    CREATE INDEX payment_allocations_expense_idx ON payment_allocations (expense_id) WHERE expense_id IS NOT NULL;

    CREATE TABLE account_transfers (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id     uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      transfer_date   date NOT NULL,
      from_account_id uuid NOT NULL,
      to_account_id   uuid NOT NULL,
      amount          numeric(15,2) NOT NULL CHECK (amount > 0),
      notes           text,
      status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
      created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
      cancelled_at    timestamptz,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, id),
      FOREIGN KEY (business_id, from_account_id) REFERENCES accounts (business_id, id) DEFERRABLE,
      FOREIGN KEY (business_id, to_account_id) REFERENCES accounts (business_id, id) DEFERRABLE,
      CONSTRAINT account_transfers_different_accounts CHECK (from_account_id <> to_account_id),
      CONSTRAINT account_transfers_cancelled_consistent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
    );

    CREATE TABLE stock_adjustments (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id     uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      adjustment_date date NOT NULL,
      reason          text NOT NULL CHECK (reason IN ('damage', 'count', 'opening', 'other')),
      notes           text,
      status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
      created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
      cancelled_at    timestamptz,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, id),
      CONSTRAINT stock_adjustments_cancelled_consistent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
    );

    CREATE TABLE stock_adjustment_lines (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id   uuid NOT NULL,
      adjustment_id uuid NOT NULL,
      item_id       uuid NOT NULL,
      quantity      numeric(15,3) NOT NULL CHECK (quantity <> 0),
      unit_cost     numeric(15,4) CHECK (unit_cost >= 0),
      created_at    timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (business_id, adjustment_id) REFERENCES stock_adjustments (business_id, id) ON DELETE CASCADE,
      FOREIGN KEY (business_id, item_id) REFERENCES items (business_id, id) DEFERRABLE
    );
    CREATE INDEX stock_adjustment_lines_adjustment_idx ON stock_adjustment_lines (adjustment_id);

    -- Keeps payments.amount_allocated and the amount_settled columns equal to
    -- the sum of their allocations, so application code never writes them.
    -- The CHECK constraints on those columns then reject over-allocation.
    CREATE FUNCTION refresh_allocation_totals(
      p_payment uuid, p_invoice uuid, p_charge uuid, p_expense uuid
    ) RETURNS void
    LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE payments SET amount_allocated =
        (SELECT COALESCE(SUM(amount), 0) FROM payment_allocations WHERE payment_id = p_payment)
      WHERE id = p_payment;

      IF p_invoice IS NOT NULL THEN
        UPDATE invoices SET amount_settled =
          (SELECT COALESCE(SUM(amount), 0) FROM payment_allocations WHERE invoice_id = p_invoice)
        WHERE id = p_invoice;
      END IF;

      IF p_charge IS NOT NULL THEN
        UPDATE invoice_charges SET amount_settled =
          (SELECT COALESCE(SUM(amount), 0) FROM payment_allocations WHERE invoice_charge_id = p_charge)
        WHERE id = p_charge;
      END IF;

      IF p_expense IS NOT NULL THEN
        UPDATE expenses SET amount_settled =
          (SELECT COALESCE(SUM(amount), 0) FROM payment_allocations WHERE expense_id = p_expense)
        WHERE id = p_expense;
      END IF;
    END
    $$;

    CREATE FUNCTION payment_allocations_sync() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP <> 'DELETE' THEN
        -- Only live documents can be settled.
        IF EXISTS (SELECT 1 FROM payments WHERE id = NEW.payment_id AND status <> 'active')
          OR EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND status <> 'final')
          OR EXISTS (SELECT 1 FROM invoice_charges c JOIN invoices i ON i.id = c.invoice_id
                     WHERE c.id = NEW.invoice_charge_id AND i.status <> 'final')
          OR EXISTS (SELECT 1 FROM expenses WHERE id = NEW.expense_id AND status <> 'active')
        THEN
          RAISE EXCEPTION 'Allocations need an active payment and a final or active document'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'payment_allocations_open_documents';
        END IF;
      END IF;

      IF TG_OP <> 'INSERT' THEN
        PERFORM refresh_allocation_totals(OLD.payment_id, OLD.invoice_id, OLD.invoice_charge_id, OLD.expense_id);
      END IF;
      IF TG_OP <> 'DELETE' THEN
        PERFORM refresh_allocation_totals(NEW.payment_id, NEW.invoice_id, NEW.invoice_charge_id, NEW.expense_id);
      END IF;
      RETURN NULL;
    END
    $$;

    CREATE TRIGGER payment_allocations_sync
      AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
      FOR EACH ROW EXECUTE FUNCTION payment_allocations_sync();

    ${updatedAt(
      "document_series",
      "invoices",
      "invoice_charges",
      "expenses",
      "payments",
      "account_transfers",
      "stock_adjustments",
    )}
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DROP TABLE stock_adjustment_lines;
    DROP TABLE stock_adjustments;
    DROP TABLE account_transfers;
    DROP TABLE payment_allocations;
    DROP FUNCTION payment_allocations_sync();
    DROP FUNCTION refresh_allocation_totals(uuid, uuid, uuid, uuid);
    DROP TABLE payments;
    DROP TABLE expenses;
    DROP TABLE invoice_charges;
    DROP TABLE invoice_lines;
    DROP TABLE invoices;
    DROP TABLE document_series;
  `);
}
