export const shorthands = undefined;

const GSTIN = `'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`;
const STATE_CODE = `'^[0-9]{2}$'`;

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
    CREATE TABLE users (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 255),
      email             citext NOT NULL UNIQUE CHECK (length(email) <= 255),
      phone             text CHECK (length(phone) <= 20),
      password_hash     text NOT NULL,
      is_active         boolean NOT NULL DEFAULT true,
      email_verified_at timestamptz,
      last_login_at     timestamptz,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now()
    );

    -- Only a hash of each refresh token is stored. Rotation keeps family_id, so
    -- presenting an already-rotated token revokes the whole family.
    CREATE TABLE refresh_tokens (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      family_id      uuid NOT NULL,
      token_hash     text NOT NULL UNIQUE,
      device_info    text,
      expires_at     timestamptz NOT NULL,
      revoked_at     timestamptz,
      replaced_by_id uuid REFERENCES refresh_tokens (id) ON DELETE SET NULL,
      created_at     timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
    CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id);
    CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);

    CREATE TABLE businesses (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name                  text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 255),
      legal_name            text CHECK (length(legal_name) <= 255),
      gst_registration_type text NOT NULL DEFAULT 'unregistered'
                            CHECK (gst_registration_type IN ('regular', 'composition', 'unregistered')),
      gstin                 varchar(15) CHECK (gstin ~ ${GSTIN}),
      pan                   varchar(10) CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
      -- GST state code of the business's registered place; decides intra- vs
      -- inter-state supply on every GST invoice.
      state_code            char(2) NOT NULL CHECK (state_code ~ ${STATE_CODE}),
      address               jsonb NOT NULL DEFAULT '{}'::jsonb,
      phone                 text CHECK (length(phone) <= 20),
      email                 citext,
      logo_url              text,
      signature_url         text,
      fy_start_month        smallint NOT NULL DEFAULT 4 CHECK (fy_start_month BETWEEN 1 AND 12),
      settings              jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by            uuid REFERENCES users (id) ON DELETE SET NULL,
      archived_at           timestamptz,
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT businesses_gstin_required
        CHECK (gst_registration_type = 'unregistered' OR gstin IS NOT NULL),
      CONSTRAINT businesses_gstin_matches_state
        CHECK (gstin IS NULL OR substr(gstin, 1, 2) = state_code)
    );

    CREATE TABLE business_members (
      business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      role        text NOT NULL CHECK (role IN ('owner', 'admin', 'accountant', 'staff')),
      status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
      invited_by  uuid REFERENCES users (id) ON DELETE SET NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (business_id, user_id)
    );
    CREATE INDEX business_members_user_id_idx ON business_members (user_id);
    CREATE UNIQUE INDEX business_members_one_owner
      ON business_members (business_id) WHERE role = 'owner' AND status = 'active';

    CREATE TABLE business_invites (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
      email       citext NOT NULL,
      role        text NOT NULL CHECK (role IN ('admin', 'accountant', 'staff')),
      token_hash  text NOT NULL UNIQUE,
      invited_by  uuid REFERENCES users (id) ON DELETE SET NULL,
      expires_at  timestamptz NOT NULL,
      accepted_at timestamptz,
      revoked_at  timestamptz,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX business_invites_one_open_per_email
      ON business_invites (business_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

    ${updatedAt("users", "businesses", "business_members")}
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DROP TABLE business_invites;
    DROP TABLE business_members;
    DROP TABLE businesses;
    DROP TABLE refresh_tokens;
    DROP TABLE users;
  `);
}
