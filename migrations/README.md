/_ DEPLOYMENT GUIDE FOR GIT COMMANDS _/

-- Database Migration Setup
-- This project uses node-pg-migrate for schema versioning
-- Install globally: npm install -g node-pg-migrate

-- Create a new migration:
-- npx node-pg-migrate create -d ./migrations your_migration_name

-- Run all pending migrations up:
-- npx node-pg-migrate up -d ./migrations --tsconfig

-- Rollback last migration:
-- npx node-pg-migrate down -d ./migrations

-- The environment variable DATABASE_URL must be set in your .env file
-- Example: DATABASE_URL=postgres://user:password@localhost:5432/vyaparsetu
