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

/** Platform table (no RLS): one row per person, across every business they belong to. */
export interface UsersTable {
  id: Generated<string>;
  /** Trimmed and lower-cased; unique. */
  email: string;
  /** argon2id; null until the user accepts their first invitation. */
  password_hash: string | null;
  full_name: Generated<string>;
  email_verified_at: Date | null;
  last_login_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Fixed roles for the MVP; replaced by the roles table in BOS-021. */
export type MembershipRole = 'owner' | 'staff';
export type MembershipStatus = 'invited' | 'active' | 'disabled';

/** Which businesses a user belongs to. Tenant-scoped, plus the read-only `member_self` policy. */
export interface TenantMembershipsTable extends TenantScoped {
  user_id: string;
  role: MembershipRole;
  status: Generated<MembershipStatus>;
  /** SHA-256 of the secret part of the invitation token; null once accepted. */
  invite_token_hash: string | null;
  invite_expires_at: Date | null;
  invited_by: string | null;
}

/**
 * Table name → row type, used by Kysely to type-check queries.
 * Add each table here in the same PR as the migration that creates it.
 */
export interface Database {
  tenants: TenantsTable;
  users: UsersTable;
  tenant_memberships: TenantMembershipsTable;
}

/** Builds a Kysely instance over its own `pg` pool; `destroy()` ends the pool. */
export function createDb(connectionString: string, onPoolError?: (err: Error) => void) {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000 });
  if (onPoolError) {
    pool.on('error', onPoolError);
  }
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
