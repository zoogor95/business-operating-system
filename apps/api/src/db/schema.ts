import { type QueryExecutorProvider, sql } from 'kysely';

/**
 * Migration helpers for tenant-scoped tables. Each takes the migration's `db` (or a transaction). They encode docs/database-conventions.md, so a new
 * table gets the standard columns, trigger and RLS policy without hand-written boilerplate:
 *
 *   await createTenantTable(db, 'customers', ['full_name text not null', 'phone_e164 text'], {
 *     softDelete: true,
 *   });
 */

/** The role the API runs as (migration 0003). Never a superuser, never BYPASSRLS. */
export const APP_ROLE = 'bos_app';

/** Name of the one RLS policy every tenant-scoped table has. */
export const TENANT_POLICY = 'tenant_isolation';

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

/** Guards names that are interpolated into DDL. They come from our migrations, never user input. */
export function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return name;
}

export interface TenantTableOptions {
  /** Adds `deleted_at` for master data that is soft-deleted (customers, products, variants). */
  softDelete?: boolean;
}

/**
 * Creates a tenant-scoped table: `id`, `tenant_id` (FK to tenants), then `columns`, then the base
 * columns `created_at`/`created_by`/`updated_at`/`updated_by` (+ `deleted_at` with `softDelete`),
 * plus `unique (tenant_id, id)` so other tenant tables can reference it with a composite foreign
 * key `(tenant_id, x_id) references x (tenant_id, id)`. Attaches the `updated_at` trigger and
 * enables Row-Level Security with the standard policy.
 *
 * `columns` are raw SQL column or constraint definitions, e.g. `'label text not null'`.
 * Undo with a plain `drop table`.
 */
export async function createTenantTable(
  db: QueryExecutorProvider,
  table: string,
  columns: readonly string[],
  options: TenantTableOptions = {},
): Promise<void> {
  const name = identifier(table);
  const definitions = [
    'id uuid primary key default gen_random_uuid()',
    'tenant_id uuid not null references tenants (id)',
    ...columns,
    'created_at timestamptz not null default now()',
    'created_by uuid',
    'updated_at timestamptz not null default now()',
    'updated_by uuid',
    ...(options.softDelete ? ['deleted_at timestamptz'] : []),
    `constraint uq_${name}__tenant_id_id unique (tenant_id, id)`,
  ];
  await sql.raw(`create table ${name} (\n  ${definitions.join(',\n  ')}\n)`).execute(db);
  await addUpdatedAtTrigger(db, name);
  await enableTenantRls(db, name);
}

/** Keeps `updated_at` current on every update (function from migration 0001). */
export async function addUpdatedAtTrigger(db: QueryExecutorProvider, table: string): Promise<void> {
  const name = identifier(table);
  await sql
    .raw(
      `create trigger trg_${name}__set_updated_at before update on ${name} ` +
        'for each row execute function set_updated_at()',
    )
    .execute(db);
}

/**
 * Enables and forces RLS with the standard policy: rows are visible and writable only when
 * `tenant_id` matches the tenant set by `DatabaseService.withTenant()`. Outside a tenant
 * transaction `current_tenant_id()` is null, so the table reads as empty and rejects writes.
 */
export async function enableTenantRls(db: QueryExecutorProvider, table: string): Promise<void> {
  const name = identifier(table);
  await sql.raw(`alter table ${name} enable row level security`).execute(db);
  await sql.raw(`alter table ${name} force row level security`).execute(db);
  await sql
    .raw(
      `create policy ${TENANT_POLICY} on ${name} ` +
        'using (tenant_id = current_tenant_id()) ' +
        'with check (tenant_id = current_tenant_id())',
    )
    .execute(db);
}
