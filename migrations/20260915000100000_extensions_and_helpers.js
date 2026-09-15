export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS citext;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    -- Attached to every table that has an updated_at column, so no query has
    -- to remember to set it.
    CREATE FUNCTION set_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END
    $$;
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DROP FUNCTION set_updated_at();
    DROP EXTENSION pg_trgm;
    DROP EXTENSION citext;
  `);
}
