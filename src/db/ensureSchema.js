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
        shipping_address TEXT,
        party_type VARCHAR(50) NOT NULL CHECK (party_type IN ('customer', 'supplier', 'both')),
        opening_balance NUMERIC(15, 2) DEFAULT 0.00,
        opening_balance_type VARCHAR(20) DEFAULT 'receive' CHECK (opening_balance_type IN ('receive', 'pay')),
        current_balance NUMERIC(15, 2) DEFAULT 0.00,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_party_name_per_business UNIQUE (business_id, name)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_parties_business_id ON parties(business_id);`);

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
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_items_business_id ON items(business_id);`);

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
        invoice_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        due_date TIMESTAMP WITH TIME ZONE,
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
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_business_id ON invoices(business_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoices_party_id ON invoices(party_id);`);

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
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);`);

    // Ensure payments table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
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
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_business_id ON payments(business_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_party_id ON payments(party_id);`);

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
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON expenses(business_id);`);
    // Drop stock_transactions table as we no longer track stock transactions
    await pool.query(`DROP TABLE IF EXISTS stock_transactions CASCADE;`);

    console.log("Database schema checked and ensured successfully!");
  } catch (error) {
    console.error("Failed to ensure database schema:", error);
    throw error;
  }
}
