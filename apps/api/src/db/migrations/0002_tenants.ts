import { type Kysely, sql } from 'kysely';

// BOS-010: the tenants table. A platform table: no tenant_id and no RLS of its own, because it is
// the thing every tenant-scoped table points at (see docs/erd.md §1).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table tenants (
      id uuid primary key default gen_random_uuid(),
      slug text not null,
      name text not null,
      business_type text not null,
      template_id uuid,
      status text not null default 'trial',
      timezone text not null default 'Asia/Kuala_Lumpur',
      currency text not null default 'MYR',
      profile jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint uq_tenants__slug unique (slug),
      constraint ck_tenants__slug check (slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
      constraint ck_tenants__status check (status in ('trial', 'active', 'suspended', 'cancelled')),
      constraint ck_tenants__currency check (currency ~ '^[A-Z]{3}$'),
      constraint ck_tenants__profile check (jsonb_typeof(profile) = 'object')
    )
  `.execute(db);

  await sql`
    create trigger trg_tenants__set_updated_at
    before update on tenants
    for each row execute function set_updated_at()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table tenants`.execute(db);
}
