export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`
    -- Positive balance = receivable (the party owes the business).
    CREATE VIEW party_balances AS
    SELECT p.business_id,
           p.id AS party_id,
           COALESCE(SUM(e.debit - e.credit), 0)::numeric(15,2) AS balance
    FROM parties p
    LEFT JOIN party_ledger_entries e ON e.business_id = p.business_id AND e.party_id = p.id
    GROUP BY p.business_id, p.id;

    CREATE VIEW account_balances AS
    SELECT a.business_id,
           a.id AS account_id,
           a.account_type,
           COALESCE(SUM(e.amount), 0)::numeric(15,2) AS balance
    FROM accounts a
    LEFT JOIN account_entries e ON e.business_id = a.business_id AND e.account_id = a.id
    GROUP BY a.business_id, a.id, a.account_type;

    -- average_cost is the weighted cost of all costed stock that came in.
    CREATE VIEW item_stock AS
    SELECT i.business_id,
           i.id AS item_id,
           COALESCE(SUM(m.quantity), 0)::numeric(15,3) AS quantity_on_hand,
           (SUM(m.quantity * m.unit_cost) FILTER (WHERE m.quantity > 0 AND m.unit_cost IS NOT NULL)
             / NULLIF(SUM(m.quantity) FILTER (WHERE m.quantity > 0 AND m.unit_cost IS NOT NULL), 0)
           )::numeric(15,4) AS average_cost
    FROM items i
    LEFT JOIN stock_movements m ON m.business_id = i.business_id AND m.item_id = i.id
    WHERE i.track_stock
    GROUP BY i.business_id, i.id;

    CREATE VIEW invoice_outstanding AS
    SELECT id AS invoice_id,
           business_id,
           invoice_type,
           tax_mode,
           party_id,
           invoice_number,
           invoice_date,
           due_date,
           total_amount,
           amount_settled,
           (total_amount - amount_settled)::numeric(15,2) AS outstanding,
           GREATEST(CURRENT_DATE - due_date, 0) AS days_overdue
    FROM invoices
    WHERE status = 'final' AND amount_settled < total_amount;

    CREATE INDEX parties_name_trgm_idx ON parties USING gin (name gin_trgm_ops);
    CREATE INDEX items_name_trgm_idx ON items USING gin (name gin_trgm_ops);
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DROP INDEX items_name_trgm_idx;
    DROP INDEX parties_name_trgm_idx;
    DROP VIEW invoice_outstanding;
    DROP VIEW item_stock;
    DROP VIEW account_balances;
    DROP VIEW party_balances;
  `);
}
