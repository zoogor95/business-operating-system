import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Loads the repo-root `.env` (see `.env.example`) for local development.
// Variables already set in the environment win. Replaced by typed, validated
// config in BOS-007.
const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/** The variable's value, or `undefined` when it is unset or empty. */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

export function requireEnv(name: string): string {
  const value = optionalEnv(name);
  if (value === undefined) {
    throw new Error(`Missing required env var ${name} — copy .env.example to .env`);
  }
  return value;
}

/**
 * Connection string for schema work (migrations, `db:verify`, `db:dev-role`): the database owner.
 * `DATABASE_URL` is the API's own login, which cannot change the schema (BOS-011).
 * Falls back to `DATABASE_URL` for setups that still use one role for everything.
 */
export function migrationDatabaseUrl(): string {
  return optionalEnv('MIGRATION_DATABASE_URL') ?? requireEnv('DATABASE_URL');
}
