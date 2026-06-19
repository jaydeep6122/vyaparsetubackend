export const shorthands = undefined;

export async function up(pgm) {
  pgm.createTable("factories", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    name: { type: "varchar(255)", notNull: true },
    location: { type: "varchar(255)" },
    created_at: { type: "timestamp with time zone", default: pgm.func("CURRENT_TIMESTAMP") },
    updated_at: { type: "timestamp with time zone", default: pgm.func("CURRENT_TIMESTAMP") },
  });

  pgm.createTable("workers", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    factory_id: { type: "uuid", notNull: true, references: "factories", onDelete: "CASCADE" },
    name: { type: "varchar(255)", notNull: true },
    type: {
      type: "varchar(50)",
      notNull: true,
      check: "type IN ('producer_molder', 'kiln_worker', 'truck_worker')",
    },
    rate_per_1000: { type: "numeric(10, 2)", notNull: true },
    total_bricks: { type: "integer", default: 0 },
    total_amount: { type: "numeric(15, 2)", default: 0 },
    total_money_given: { type: "numeric(15, 2)", default: 0 },
    status: {
      type: "varchar(20)",
      default: "active",
      check: "status IN ('active', 'inactive')",
    },
    created_at: { type: "timestamp with time zone", default: pgm.func("CURRENT_TIMESTAMP") },
    updated_at: { type: "timestamp with time zone", default: pgm.func("CURRENT_TIMESTAMP") },
  });

  pgm.createTable("transaction_logs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    factory_id: { type: "uuid", notNull: true, references: "factories", onDelete: "CASCADE" },
    type: {
      type: "varchar(50)",
      notNull: true,
      check: "type IN ('handoff', 'direct', 'truck_dist', 'money_given')",
    },
    kiln_worker_id: { type: "uuid", references: "workers" },
    producer_molder_id: { type: "uuid", references: "workers" },
    worker_id: { type: "uuid", references: "workers" },
    truck_worker_ids: { type: "jsonb" },
    quantity: { type: "integer" },
    amount: { type: "numeric(15, 2)" },
    date: { type: "date", notNull: true },
    notes: { type: "text" },
    created_at: { type: "timestamp with time zone", default: pgm.func("CURRENT_TIMESTAMP") },
  });

  pgm.createIndex("factories", "user_id");
  pgm.createIndex("workers", "factory_id");
  pgm.createIndex("workers", "type");
  pgm.createIndex("transaction_logs", "factory_id");
  pgm.createIndex("transaction_logs", "date");
  pgm.createIndex("transaction_logs", "type");
}

export async function down(pgm) {
  pgm.dropTable("transaction_logs");
  pgm.dropTable("workers");
  pgm.dropTable("factories");
}
