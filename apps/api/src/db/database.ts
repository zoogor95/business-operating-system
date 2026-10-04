import { type Generated, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

/**
 * Columns `createTenantTable()` adds to every tenant-scoped table (docs/database-conventions.md).
 * Row types of tenant tables extend it.
 */
export interface TenantScoped {
  id: Generated<string>;
  tenant_id: string;
  created_at: Generated<Date>;
  created_by: string | null;
  updated_at: Generated<Date>;
  updated_by: string | null;
}

/** Extend this too for tables created with `{ softDelete: true }`. */
export interface SoftDeletable {
  deleted_at: Date | null;
}

export type TenantStatus = 'trial' | 'active' | 'suspended' | 'cancelled';

/** Platform table (no RLS): one row per business using BOS. */
export interface TenantsTable {
  id: Generated<string>;
  slug: string;
  name: string;
  /** Business type template key, e.g. `optical`, `general_retail`. */
  business_type: string;
  template_id: string | null;
  status: Generated<TenantStatus>;
  /** IANA zone used for day boundaries in reports and numbering. */
  timezone: Generated<string>;
  /** ISO 4217 code; money columns are integer minor units of it. */
  currency: Generated<string>;
  /** SSM/SST numbers, address, logo file id. Validated in the API. */
  profile: Generated<Record<string, unknown>>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * Table name → row type, used by Kysely to type-check queries.
 * Add each table here in the same PR as the migration that creates it.
 */
export interface Database {
  tenants: TenantsTable;
}

/** Builds a Kysely instance over its own `pg` pool; `destroy()` ends the pool. */
export function createDb(connectionString: string, onPoolError?: (err: Error) => void) {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000 });
  if (onPoolError) {
    pool.on('error', onPoolError);
  }
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
