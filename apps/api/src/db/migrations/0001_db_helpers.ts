import { type Kysely, sql } from 'kysely';

// Shared helpers for tenant-scoped tables (BOS-010) and their RLS policies (BOS-011).
export async function up(db: Kysely<unknown>): Promise<void> {
  // Keeps `updated_at` current; attach with `before update ... for each row`.
  await sql`
    create function set_updated_at() returns trigger
    language plpgsql as $$
    begin
      new.updated_at = now();
      return new;
    end
    $$
  `.execute(db);

  // Tenant set by DatabaseService.withTenant(), or null outside a tenant transaction.
  await sql`
    create function current_tenant_id() returns uuid
    language sql stable as $$
      select nullif(current_setting('app.current_tenant', true), '')::uuid
    $$
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop function current_tenant_id()`.execute(db);
  await sql`drop function set_updated_at()`.execute(db);
}
