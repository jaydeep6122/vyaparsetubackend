export const shorthands = undefined;

export async function up(pgm) {
  // Create businesses table
  pgm.createTable("businesses", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    name: { type: "varchar(255)", notNull: true },
    email: { type: "varchar(255)" },
    phone: { type: "varchar(50)" },
    address: { type: "text", notNull: true },
    city: { type: "varchar(100)", notNull: true },
    state: { type: "varchar(100)", notNull: true },
    pincode: { type: "varchar(20)", notNull: true },
    gstin: { type: "varchar(15)", unique: true },
    pan_number: { type: "varchar(10)" },
    business_type: { type: "varchar(50)", notNull: true, check: "business_type IN ('retailer', 'wholesaler', 'service')" },
    invoice_prefix: { type: "varchar(50)", notNull: true },
    invoice_counter: { type: "integer", default: 1 },
    financial_year: { type: "varchar(50)", notNull: true },
    logo_url: { type: "text" },
    signature_url: { type: "text" },
    bank_name: { type: "varchar(255)" },
    account_number: { type: "varchar(50)" },
    ifsc_code: { type: "varchar(20)" },
    upi_id: { type: "varchar(255)" },
    is_active: { type: "boolean", default: true },
    created_at: { type: "timestamp with time zone", default: pgm.func("CURRENT_TIMESTAMP") },
    updated_at: { type: "timestamp with time zone", default: pgm.func("CURRENT_TIMESTAMP") },
  });

  // Create parties table
  pgm.createTable("parties", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    business_id: { type: "uuid", notNull: true, references: "businesses", onDelete: "CASCADE" },
    name: { type: "varchar(255)", notNull: true },
    phone: { type: "varchar(50)" },
    email: { type: "varchar(255)" },
    gstin: { type: "varchar(15)" },
    billing_address: { type: "text" },
    shipping_address: { type: "jsonb" },
    party_type: { type: "varchar(50)", notNull: true, check: "party_type IN ('customer', 'supplier', 'both')" },
    opening_balance: { type: "numeric(15, 2)", default: 0.00 },
    opening_balance_type: { type: "varchar(20)", default: "'receive'", check: "opening_balance_type IN ('receive', 'pay')" },
    current_balance: { type: "numeric(15, 2)", default: 0.00 },
    created_at: { type: "timestamp with time zone", default: pgm.func("CURRENT_TIMESTAMP") },
    updated_at: { type: "timestamp with time zone", default: pgm.func("CURRENT_TIMESTAMP") },
  });

  // Create items table
  pgm.createTable("items", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    business_id: { type: "uuid", notNull: true, references: "businesses", onDelete: "CASCADE" },
    name: { type: "varchar(255)", notNull: true },
    hsn_code: { type: "varchar(20)" },
    measuring_unit: { type: "varchar(50)", default: "'pcs'" },
    created_at: { type: "timestamp with time zone", default: pgm.func("CURRENT_TIMESTAMP") },
    updated_at: { type: "timestamp with time zone", default: pgm.func("CURRENT_TIMESTAMP") },
  });
}

export async function down(pgm) {
  pgm.dropTable("items");
  pgm.dropTable("parties");
  pgm.dropTable("businesses");
}
