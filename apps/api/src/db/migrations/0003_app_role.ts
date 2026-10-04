import { type Kysely, sql } from 'kysely';

// BOS-011: the role the API runs as. It owns nothing, is not a superuser and cannot bypass RLS,
// so every tenant-scoped query is filtered by the `tenant_isolation` policies. The API logs in as
// a separate login role that is a member of it (`pnpm db:dev-role` creates one locally).
//
// Roles are cluster-wide, hence `if not exists`: test databases on the same server share it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    do $$
    begin
      if not exists (select from pg_roles where rolname = 'bos_app') then
        create role bos_app nologin nosuperuser nobypassrls;
      end if;
    end
    $$
  `.execute(db);

  await sql`grant usage on schema public to bos_app`.execute(db);
  await sql`grant execute on function current_tenant_id() to bos_app`.execute(db);
  await sql`grant select, insert, update, delete on tenants to bos_app`.execute(db);

  // Tables and sequences created by later migrations (run as this same owner) are granted
  // automatically. The migrator's own tables existed before this and stay out of reach.
  await sql`
    alter default privileges in schema public
    grant select, insert, update, delete on tables to bos_app
  `.execute(db);
  await sql`
    alter default privileges in schema public
    grant usage, select on sequences to bos_app
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter default privileges in schema public
    revoke select, insert, update, delete on tables from bos_app
  `.execute(db);
  await sql`
    alter default privileges in schema public
    revoke usage, select on sequences from bos_app
  `.execute(db);
  await sql`revoke all on all tables in schema public from bos_app`.execute(db);
  await sql`revoke execute on function current_tenant_id() from bos_app`.execute(db);
  await sql`revoke usage on schema public from bos_app`.execute(db);
  await sql`drop role bos_app`.execute(db);
}
