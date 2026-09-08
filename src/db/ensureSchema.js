import pool from "./db.js";

export async function ensureSchema() {
  try {
    console.log("Checking and ensuring database schema...");

    // Ensure users table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure specific columns exist in case users table already existed
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `);

    // Ensure refresh_tokens table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        device_info TEXT,
        is_revoked BOOLEAN DEFAULT FALSE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure businesses table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS businesses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        address TEXT NOT NULL,
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NOT NULL,
        pincode VARCHAR(20) NOT NULL,
        gstin VARCHAR(15) UNIQUE,
        pan_number VARCHAR(10),
        business_type VARCHAR(50) NOT NULL CHECK (business_type IN ('retailer', 'wholesaler', 'service')),
        invoice_prefix VARCHAR(50) NOT NULL,
        invoice_counter INTEGER DEFAULT 1,
        financial_year VARCHAR(50) NOT NULL,
        logo_url TEXT,
        signature_url TEXT,
        bank_name VARCHAR(255),
        account_number VARCHAR(50),
        ifsc_code VARCHAR(20),
        upi_id VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure unique constraint exists on gstin for existing installations
    await pool
      .query(
        `
      ALTER TABLE businesses ADD CONSTRAINT businesses_gstin_key UNIQUE (gstin);
    `,
      )
      .catch((err) => {
        // 42710 = duplicate_object
        // 42P07 = duplicate_relation (already exists)
        // 23505 = unique_violation (duplicate values exist in existing rows)
        if (err.code === "23505") {
          console.warn(
            "WARNING: Could not apply UNIQUE constraint to businesses.gstin because duplicate values already exist. Please clean up duplicate businesses in the database.",
          );
        } else if (err.code !== "42710" && err.code !== "42P07") {
          throw err;
        }
      });

    // Ensure parties table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS parties (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        email VARCHAR(255),
        gstin VARCHAR(15),
        billing_address TEXT,
        shipping_address JSONB,
        party_type VARCHAR(50) NOT NULL CHECK (party_type IN ('customer', 'supplier', 'both', 'transporter')),
        opening_balance NUMERIC(15, 2) DEFAULT 0.00,
        opening_balance_type VARCHAR(20) DEFAULT 'receive' CHECK (opening_balance_type IN ('receive', 'pay')),
        current_balance NUMERIC(15, 2) DEFAULT 0.00,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_party_name_per_business UNIQUE (business_id, name)
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_parties_business_id ON parties(business_id);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_parties_business_balance ON parties(business_id, current_balance);`,
    );
    await pool
      .query(
        `
      ALTER TABLE parties ALTER COLUMN shipping_address TYPE JSONB USING to_jsonb(shipping_address);
    `,
      )
      .catch(() => {});

    // Widen party_type to admit transporters on installs that predate them.
    // An inline CHECK cannot be altered in place, so it has to be dropped and
    // re-added; the constraint is looked up in the catalogue rather than by its
    // generated name because a hand-restored database may have named it
    // differently. The whole thing is skipped once 'transporter' is already
    // allowed - it takes an ACCESS EXCLUSIVE lock on parties, and this runs on
    // every boot (the same reason the RLS block below is conditional).
    await pool
      .query(
        `
      DO $$
      DECLARE cname text; cdef text;
      BEGIN
        SELECT conname, pg_get_constraintdef(oid) INTO cname, cdef
        FROM pg_constraint
        WHERE conrelid = 'parties'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%party_type%'
        LIMIT 1;

        IF cname IS NULL THEN
          ALTER TABLE parties ADD CONSTRAINT parties_party_type_check
            CHECK (party_type IN ('customer', 'supplier', 'both', 'transporter'));
        ELSIF cdef NOT ILIKE '%transporter%' THEN
          EXECUTE format('ALTER TABLE parties DROP CONSTRAINT %I', cname);
          ALTER TABLE parties ADD CONSTRAINT parties_party_type_check
            CHECK (party_type IN ('customer', 'supplier', 'both', 'transporter'));
        END IF;
      END $$;
    `,
      )
      .catch((err) => {
        // 42710 = duplicate_object, 42P07 = duplicate_relation
        if (err.code !== "42710" && err.code !== "42P07") {
          throw err;
        }
      });

    // Ensure items table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        hsn_code VARCHAR(20),
        measuring_unit VARCHAR(50) DEFAULT 'pcs',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_item_name_per_business UNIQUE (business_id, name)
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_items_business_id ON items(business_id);`,
    );

    // Drop unused items columns and constraints cascade for existing installations
    await pool.query(`
      ALTER TABLE items DROP COLUMN IF EXISTS item_type CASCADE;
      ALTER TABLE items DROP COLUMN IF EXISTS sku CASCADE;
      ALTER TABLE items DROP COLUMN IF EXISTS sales_price CASCADE;
      ALTER TABLE items DROP COLUMN IF EXISTS purchase_price CASCADE;
      ALTER TABLE items DROP COLUMN IF EXISTS tax_rate CASCADE;
      ALTER TABLE items DROP COLUMN IF EXISTS is_tax_inclusive CASCADE;
      ALTER TABLE items DROP COLUMN IF EXISTS opening_stock CASCADE;
      ALTER TABLE items DROP COLUMN IF EXISTS current_stock CASCADE;
      ALTER TABLE items DROP COLUMN IF EXISTS low_stock_warning CASCADE;
    `);

    // Ensure invoices table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
        invoice_number VARCHAR(100) NOT NULL,
        invoice_type VARCHAR(50) NOT NULL CHECK (invoice_type IN ('sale', 'purchase', 'sale_return', 'purchase_return')),
        chalan_no VARCHAR(100),
        transport_cost NUMERIC(15, 2) DEFAULT 0.00,
        transporter_party_id UUID REFERENCES parties(id) ON DELETE RESTRICT,
        vehicle_no VARCHAR(50),
        transport_qty NUMERIC(15, 2),
        transport_rate NUMERIC(15, 4),
        transport_paid_amount NUMERIC(15, 2) DEFAULT 0.00,
        invoice_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        due_date TIMESTAMP WITH TIME ZONE,
        delivery_date TIMESTAMP WITH TIME ZONE,
        sub_total NUMERIC(15, 2) NOT NULL,
        tax_amount NUMERIC(15, 2) DEFAULT 0.00,
        discount_amount NUMERIC(15, 2) DEFAULT 0.00,
        total_amount NUMERIC(15, 2) NOT NULL,
        paid_amount NUMERIC(15, 2) DEFAULT 0.00,
        payment_status VARCHAR(50) NOT NULL CHECK (payment_status IN ('paid', 'unpaid', 'partially_paid')),
        payment_mode VARCHAR(50) NOT NULL CHECK (payment_mode IN ('cash', 'bank', 'upi', 'credit', 'multiple')),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_invoice_number_per_business_and_type UNIQUE (business_id, invoice_type, invoice_number)
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_invoices_business_id ON invoices(business_id);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_invoices_party_id ON invoices(party_id);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_invoices_business_type ON invoices(business_id, invoice_type);`,
    );
    await pool.query(
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS chalan_no VARCHAR(100);`,
    );
    await pool.query(
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transport_cost NUMERIC(15, 2) DEFAULT 0.00;`,
    );
    await pool.query(
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_date TIMESTAMP WITH TIME ZONE;`,
    );
    // Transport is a second payable leg on a purchase: the freight is owed to
    // transporter_party_id rather than to the supplier. RESTRICT rather than
    // SET NULL on purpose - nulling the reference would silently hand the
    // amount back to the "supplier owes it" rule without touching the
    // supplier's current_balance, leaving money owed to nobody.
    await pool.query(
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transporter_party_id UUID REFERENCES parties(id) ON DELETE RESTRICT;`,
    );
    await pool.query(
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vehicle_no VARCHAR(50);`,
    );
    await pool.query(
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transport_qty NUMERIC(15, 2);`,
    );
    // 4dp: per-unit freight rates are routinely sub-rupee (0.55 a brick).
    await pool.query(
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transport_rate NUMERIC(15, 4);`,
    );
    await pool.query(
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transport_paid_amount NUMERIC(15, 2) DEFAULT 0.00;`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_invoices_transporter_party_id ON invoices(transporter_party_id);`,
    );

    // Ensure invoice_items table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        item_id UUID REFERENCES items(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        quantity NUMERIC(15, 2) NOT NULL,
        unit_price NUMERIC(15, 2) NOT NULL,
        discount_percentage NUMERIC(5, 2) DEFAULT 0.00,
        discount_amount NUMERIC(15, 2) DEFAULT 0.00,
        tax_rate NUMERIC(5, 2) DEFAULT 0.00,
        tax_amount NUMERIC(15, 2) DEFAULT 0.00,
        total_amount NUMERIC(15, 2) NOT NULL,
        hsn_code VARCHAR(20),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);`,
    );
    await pool.query(
      `ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(20);`,
    );

    // Ensure payments table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
        invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT,
        payment_type VARCHAR(50) NOT NULL CHECK (payment_type IN ('payment_in', 'payment_out')),
        reference_number VARCHAR(100),
        payment_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        amount NUMERIC(15, 2) NOT NULL,
        payment_mode VARCHAR(50) NOT NULL CHECK (payment_mode IN ('cash', 'bank', 'upi')),
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_payments_business_id ON payments(business_id);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_payments_business_type ON payments(business_id, payment_type);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_payments_party_id ON payments(party_id);`,
    );
    await pool.query(
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT;`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);`,
    );

    // Ensure expenses table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        expense_category VARCHAR(100) NOT NULL,
        expense_number VARCHAR(100) NOT NULL,
        expense_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        total_amount NUMERIC(15, 2) NOT NULL,
        paid_amount NUMERIC(15, 2) DEFAULT 0.00,
        payment_mode VARCHAR(50) NOT NULL CHECK (payment_mode IN ('cash', 'bank', 'upi', 'credit')),
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_expense_number_per_business UNIQUE (business_id, expense_number)
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON expenses(business_id);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_expenses_business_mode ON expenses(business_id, payment_mode);`,
    );
    // Drop stock_transactions table as we no longer track stock transactions
    await pool.query(`DROP TABLE IF EXISTS stock_transactions CASCADE;`);

    // Ensure factories table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS factories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        location VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_factories_user_id ON factories(user_id);`,
    );

    // Ensure workers table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS workers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL CHECK (type IN ('producer_molder', 'kiln_worker', 'truck_worker')),
        rate_per_1000 NUMERIC(10, 2) NOT NULL,
        total_bricks INTEGER DEFAULT 0,
        total_amount NUMERIC(15, 2) DEFAULT 0,
        total_money_given NUMERIC(15, 2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_worker_name_per_factory UNIQUE (factory_id, name)
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_workers_factory_id ON workers(factory_id);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_workers_type ON workers(type);`,
    );

    // Ensure transaction_logs table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transaction_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL CHECK (type IN ('handoff', 'direct', 'truck_dist', 'money_given')),
        kiln_worker_id UUID REFERENCES workers(id),
        producer_molder_id UUID REFERENCES workers(id),
        worker_id UUID REFERENCES workers(id),
        truck_worker_ids JSONB,
        quantity INTEGER,
        amount NUMERIC(15, 2),
        date DATE NOT NULL,
        notes TEXT,
        is_in BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_transaction_logs_factory_id ON transaction_logs(factory_id);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_transaction_logs_date ON transaction_logs(date);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_transaction_logs_type ON transaction_logs(type);`,
    );
    await pool.query(
      `ALTER TABLE transaction_logs ADD COLUMN IF NOT EXISTS is_in BOOLEAN DEFAULT TRUE;`,
    );

    // Ensure app_versions table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_versions (
        id SERIAL PRIMARY KEY,
        version VARCHAR(50) NOT NULL,
        platform VARCHAR(50) DEFAULT 'all',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed initial version if empty
    const versionCheck = await pool.query("SELECT COUNT(*) FROM app_versions");
    if (parseInt(versionCheck.rows[0].count, 10) === 0) {
      await pool.query(
        "INSERT INTO app_versions (version, platform) VALUES ($1, $2)",
        ["1.0.0+3", "all"],
      );
    }

    // Dynamically check and enable Row Level Security (RLS) on public tables where it's disabled.
    // Checking first prevents AccessExclusiveLock requests on already-secured tables, avoiding deadlocks in parallel test runs.
    const rlsDisabledTables = await pool.query(`
      SELECT relname 
      FROM pg_class c 
      JOIN pg_namespace n ON n.oid = c.relnamespace 
      WHERE n.nspname = 'public' 
        AND c.relkind = 'r' 
        AND c.relrowsecurity = false 
        AND c.relname IN ('users', 'refresh_tokens', 'businesses', 'parties', 'items', 'invoices', 'invoice_items', 'payments', 'expenses', 'factories', 'workers', 'transaction_logs', 'app_versions');
    `);

    for (const row of rlsDisabledTables.rows) {
      await pool.query(
        "ALTER TABLE " + row.relname + " ENABLE ROW LEVEL SECURITY;",
      );
    }

    console.log("Database schema checked and ensured successfully!");
  } catch (error) {
    if (error.code === "42P07" || error.code === "23505") {
      console.warn(
        "Database schema warning (ignoring concurrent catalog conflict):",
        error.message,
      );
      return;
    }
    console.error("Failed to ensure database schema:", error);
    throw error;
  }
}
