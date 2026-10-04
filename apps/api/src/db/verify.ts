// Database self-check: `pnpm db:verify` from the repo root, after `pnpm db:migrate` and
// `pnpm db:dev-role`. Exits non-zero if any check fails, so CI can run it (BOS-005, BOS-013).
//
// The table and isolation checks create two tenants and a probe table inside one transaction that
// is always rolled back, so the database is left exactly as it was.
import { Logger } from '@nestjs/common';
import { type Kysely, type RawBuilder, sql, type Transaction } from 'kysely';
import { migrationDatabaseUrl, requireEnv } from '../env';
import { createDb, type Database } from './database';
import { APP_ROLE, createTenantTable, TENANT_POLICY } from './schema';

const logger = new Logger('VerifyDb');

const PROBE = 'zz_verify_probe';
const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const RLS_VIOLATION = '42501';

class Rollback extends Error {}

const failures: string[] = [];

function check(ok: boolean, label: string): void {
  if (ok) {
    logger.log(`✓ ${label}`);
  } else {
    logger.error(`✗ ${label}`);
    failures.push(label);
  }
}

async function main(): Promise<void> {
  const owner = createDb(migrationDatabaseUrl());
  const app = createDb(requireEnv('DATABASE_URL'));
  try {
    await checkRoles(owner, app);
    await checkPolicies(owner);
    await owner
      .transaction()
      .execute(async (trx) => {
        await checkTenantTableHelper(trx);
        await checkIsolation(trx);
        await checkMemberships(trx);
        throw new Rollback();
      })
      .catch((err: unknown) => {
        if (!(err instanceof Rollback)) {
          throw err;
        }
      });
  } finally {
    await Promise.all([owner.destroy(), app.destroy()]);
  }

  if (failures.length > 0) {
    throw new Error(`${String(failures.length)} database check(s) failed`);
  }
  logger.log('All database checks passed');
}

/** BOS-011: the API's login can never bypass RLS. */
async function checkRoles(owner: Kysely<Database>, app: Kysely<Database>): Promise<void> {
  const role = await sql<{ unsafe: boolean }>`
    select rolsuper or rolbypassrls as unsafe from pg_roles where rolname = ${APP_ROLE}
  `.execute(owner);
  const appRole = role.rows[0];
  check(appRole !== undefined, `Role ${APP_ROLE} exists (run pnpm db:migrate)`);
  check(appRole?.unsafe === false, `${APP_ROLE} is not a superuser and has no BYPASSRLS`);

  const login = await sql<{ name: string; unsafe: boolean; member: boolean }>`
    select current_user as name,
           r.rolsuper or r.rolbypassrls as unsafe,
           pg_has_role(current_user, ${APP_ROLE}, 'member') as member
    from pg_roles r
    where r.rolname = current_user
  `.execute(app);
  const me = login.rows[0];
  if (me === undefined) {
    check(false, 'DATABASE_URL login role found');
    return;
  }
  check(!me.unsafe, `API login ${me.name} is not a superuser and has no BYPASSRLS`);
  check(me.member, `API login ${me.name} is a member of ${APP_ROLE} (run pnpm db:dev-role)`);
}

/** BOS-011: every table with a tenant_id column has RLS enabled, forced and the standard policy. */
async function checkPolicies(owner: Kysely<Database>): Promise<void> {
  const { rows } = await sql<{ table: string }>`
    select c.relname as table
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and (
        not c.relrowsecurity
        or not c.relforcerowsecurity
        or not exists (
          select from pg_policies p
          where p.schemaname = n.nspname and p.tablename = c.relname and p.policyname = ${TENANT_POLICY}
        )
      )
    order by 1
  `.execute(owner);
  check(
    rows.length === 0,
    rows.length === 0
      ? `Every table with tenant_id has RLS enabled, forced and the ${TENANT_POLICY} policy`
      : `Tables missing RLS or the ${TENANT_POLICY} policy: ${rows.map((r) => r.table).join(', ')}`,
  );
}

/** BOS-010: tenants defaults, and a table built with createTenantTable() gets the base columns. */
async function checkTenantTableHelper(trx: Transaction<Database>): Promise<void> {
  await sql`
    insert into tenants (id, slug, name, business_type)
    values (${TENANT_A}, 'zz-verify-a', 'Verify A', 'optical'),
           (${TENANT_B}, 'zz-verify-b', 'Verify B', 'optical')
  `.execute(trx);
  const tenant = await trx
    .selectFrom('tenants')
    .select(['status', 'currency', 'timezone'])
    .where('id', '=', TENANT_A)
    .executeTakeFirst();
  check(
    tenant?.status === 'trial' &&
      tenant.currency === 'MYR' &&
      tenant.timezone === 'Asia/Kuala_Lumpur',
    'New tenant defaults to trial, MYR, Asia/Kuala_Lumpur',
  );

  await createTenantTable(trx, PROBE, ['label text not null']);
  const columns = await sql<{ column_name: string }>`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${PROBE}
    order by ordinal_position
  `.execute(trx);
  const expected = 'id,tenant_id,label,created_at,created_by,updated_at,updated_by';
  check(
    columns.rows.map((c) => c.column_name).join(',') === expected,
    `createTenantTable() adds the base columns (${expected})`,
  );
  const extras = await sql<{ unique_ok: boolean; trigger_ok: boolean }>`
    select
      exists (select from pg_constraint where conname = ${`uq_${PROBE}__tenant_id_id`}) as unique_ok,
      exists (select from pg_trigger where tgname = ${`trg_${PROBE}__set_updated_at`}) as trigger_ok
  `.execute(trx);
  check(extras.rows[0]?.unique_ok === true, 'createTenantTable() adds unique (tenant_id, id)');
  check(extras.rows[0]?.trigger_ok === true, 'createTenantTable() adds the updated_at trigger');

  for (const [tenantId, label] of [
    [TENANT_A, 'a'],
    [TENANT_B, 'b'],
  ] as const) {
    await setTenant(trx, tenantId);
    await sql`insert into ${sql.id(PROBE)} (tenant_id, label) values (${tenantId}, ${label})`.execute(
      trx,
    );
  }
}

/** BOS-011: as the API role, a tenant sees and writes only its own rows. */
async function checkIsolation(trx: Transaction<Database>): Promise<void> {
  await sql`set local role ${sql.id(APP_ROLE)}`.execute(trx);

  await setTenant(trx, '');
  check((await labels(trx)) === '', 'No tenant set: tenant tables read as empty');

  await setTenant(trx, TENANT_A);
  check((await labels(trx)) === 'a', 'Tenant A sees only its own rows');

  await setTenant(trx, TENANT_B);
  check((await labels(trx)) === 'b', 'Tenant B sees only its own rows');

  await setTenant(trx, TENANT_A);
  await expectRlsViolation(
    trx,
    sql`insert into ${sql.id(PROBE)} (tenant_id, label) values (${TENANT_B}, 'x')`,
    'Tenant A cannot insert a row for tenant B',
  );
  await expectRlsViolation(
    trx,
    sql`update ${sql.id(PROBE)} set tenant_id = ${TENANT_B}`,
    'Tenant A cannot move its row to tenant B',
  );

  await sql`reset role`.execute(trx);
}

/** BOS-014: a signed-in user reads their own memberships everywhere, but changes none. */
async function checkMemberships(trx: Transaction<Database>): Promise<void> {
  const user = await trx
    .insertInto('users')
    .values({ email: 'zz-verify@example.test' })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await setTenant(trx, tenantId);
    await trx
      .insertInto('tenant_memberships')
      .values({ tenant_id: tenantId, user_id: user.id, role: 'staff', status: 'active' })
      .execute();
  }

  await sql`set local role ${sql.id(APP_ROLE)}`.execute(trx);
  const count = async (): Promise<number> => {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from tenant_memberships
    `.execute(trx);
    return rows[0]?.n ?? -1;
  };

  await setTenant(trx, '');
  await setUser(trx, user.id);
  check((await count()) === 2, 'A signed-in user sees their memberships in every tenant');

  await setUser(trx, '');
  await setTenant(trx, TENANT_A);
  check((await count()) === 1, 'Tenant A sees only its own memberships');

  await setUser(trx, user.id);
  const moved = await sql`
    update tenant_memberships set role = 'owner' where tenant_id = ${TENANT_B}
  `.execute(trx);
  check(
    moved.numAffectedRows === 0n,
    "A user can't change their membership in another tenant (member_self is read-only)",
  );

  await sql`reset role`.execute(trx);
}

async function setUser(trx: Transaction<Database>, userId: string): Promise<void> {
  await sql`select set_config('app.current_user', ${userId}, true)`.execute(trx);
}

async function setTenant(trx: Transaction<Database>, tenantId: string): Promise<void> {
  await sql`select set_config('app.current_tenant', ${tenantId}, true)`.execute(trx);
}

async function labels(trx: Transaction<Database>): Promise<string> {
  const { rows } = await sql<{ labels: string | null }>`
    select string_agg(label, ',' order by label) as labels from ${sql.id(PROBE)}
  `.execute(trx);
  return rows[0]?.labels ?? '';
}

async function expectRlsViolation(
  trx: Transaction<Database>,
  query: RawBuilder<unknown>,
  label: string,
): Promise<void> {
  await sql`savepoint verify_rls`.execute(trx);
  try {
    await query.execute(trx);
    check(false, label);
  } catch (err) {
    check(pgErrorCode(err) === RLS_VIOLATION, label);
  }
  await sql`rollback to savepoint verify_rls`.execute(trx);
}

function pgErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string'
    ? err.code
    : undefined;
}

main().catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
