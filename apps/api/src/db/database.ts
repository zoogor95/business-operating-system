import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

/**
 * Table name → row type, used by Kysely to type-check queries.
 * Tables are added here alongside the migration that creates them (tenants arrives in BOS-010).
 */
export type Database = Record<string, never>;

/** Builds a Kysely instance over its own `pg` pool; `destroy()` ends the pool. */
export function createDb(connectionString: string, onPoolError?: (err: Error) => void) {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000 });
  if (onPoolError) {
    pool.on('error', onPoolError);
  }
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
