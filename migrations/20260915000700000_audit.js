export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`
    -- Written by the application for create/update/cancel/archive of documents
    -- and masters. business_id is NULL for user-level events such as login.
    CREATE TABLE audit_log (
      id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      business_id uuid REFERENCES businesses (id) ON DELETE CASCADE,
      user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
      action      text NOT NULL CHECK (length(action) BETWEEN 1 AND 50),
      entity_type text NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 50),
      entity_id   uuid,
      before      jsonb,
      after       jsonb,
      ip          text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX audit_log_business_created_idx ON audit_log (business_id, created_at DESC);
    CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
  `);
}

export async function down(pgm) {
  pgm.sql(`DROP TABLE audit_log;`);
}
