export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`
    -- One-time codes for "forgot password". Only an HMAC of each code is
    -- stored; the newest unused code for a user is the only one that counts.
    CREATE TABLE password_resets (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      code_hash    text NOT NULL,
      attempts     smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      expires_at   timestamptz NOT NULL,
      used_at      timestamptz,
      requested_ip text,
      created_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX password_resets_user_created_idx ON password_resets (user_id, created_at DESC);
  `);
}

export async function down(pgm) {
  pgm.sql(`DROP TABLE password_resets;`);
}
