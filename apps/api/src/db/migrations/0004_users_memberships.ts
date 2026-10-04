import { type Kysely, sql } from 'kysely';
import { createTenantTable } from '../schema';

// BOS-014: users (a global identity: one email, one password, any number of businesses) and
// tenant_memberships (which businesses a user belongs to, with what role).
export async function up(db: Kysely<unknown>): Promise<void> {
  // The signed-in user for this transaction, set by DatabaseService.withUser(); null otherwise.
  await sql`
    create function current_user_id() returns uuid
    language sql stable as $$
      select nullif(current_setting('app.current_user', true), '')::uuid
    $$
  `.execute(db);
  await sql`grant execute on function current_user_id() to bos_app`.execute(db);

  // Platform table: no tenant_id and no RLS, so login can find a user before any tenant is
  // chosen. Emails are stored trimmed and lower-cased, which makes the plain unique constraint
  // case-insensitive without the citext extension (docs/erd.md, open question 4).
  await sql`
    create table users (
      id uuid primary key default gen_random_uuid(),
      email text not null,
      password_hash text,
      full_name text not null default '',
      email_verified_at timestamptz,
      last_login_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint uq_users__email unique (email),
      constraint ck_users__email check (email = lower(btrim(email)) and email like '_%@_%')
    )
  `.execute(db);
  await sql`
    create trigger trg_users__set_updated_at
    before update on users
    for each row execute function set_updated_at()
  `.execute(db);

  await createTenantTable(db, 'tenant_memberships', [
    'user_id uuid not null references users (id)',
    'role text not null',
    "status text not null default 'invited'",
    'invite_token_hash text',
    'invite_expires_at timestamptz',
    'invited_by uuid references users (id)',
    'constraint uq_tenant_memberships__tenant_id_user_id unique (tenant_id, user_id)',
    'constraint uq_tenant_memberships__invite_token_hash unique (invite_token_hash)',
    // Fixed roles for the MVP; replaced by the roles table in BOS-021.
    "constraint ck_tenant_memberships__role check (role in ('owner', 'staff'))",
    "constraint ck_tenant_memberships__status check (status in ('invited', 'active', 'disabled'))",
    'constraint ck_tenant_memberships__invite check ' +
      '((invite_token_hash is null) = (invite_expires_at is null))',
  ]);
  await sql`
    create index ix_tenant_memberships__user_id on tenant_memberships (user_id)
  `.execute(db);

  // Besides the standard tenant_isolation policy: a signed-in user can read their own
  // memberships in every tenant (to pick a business after login). Read-only: updates still
  // need the tenant context.
  await sql`
    create policy member_self on tenant_memberships
    for select
    using (user_id = current_user_id())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table tenant_memberships`.execute(db);
  await sql`drop table users`.execute(db);
  await sql`drop function current_user_id()`.execute(db);
}
