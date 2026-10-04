// Creates the local login role the API connects as: `pnpm db:dev-role`, after `pnpm db:migrate`.
// It takes the user and password from DATABASE_URL and makes that role a member of bos_app, so
// the API runs without superuser or BYPASSRLS and Row-Level Security applies (BOS-011).
//
// Local development only. In staging and production, whoever manages the database creates the
// login role with a real password and runs `grant bos_app to <login>`.
import { Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { migrationDatabaseUrl, requireEnv } from '../env';
import { createDb } from './database';
import { APP_ROLE, identifier } from './schema';

const logger = new Logger('DevRole');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

async function main(): Promise<void> {
  const appUrl = new URL(requireEnv('DATABASE_URL'));
  const ownerUrl = migrationDatabaseUrl();
  if (!LOCAL_HOSTS.has(appUrl.hostname)) {
    throw new Error(`Refusing to create roles on ${appUrl.hostname}: db:dev-role is for local use`);
  }
  const user = identifier(decodeURIComponent(appUrl.username));
  const password = decodeURIComponent(appUrl.password);
  if (user === decodeURIComponent(new URL(ownerUrl).username)) {
    throw new Error(
      'DATABASE_URL uses the database owner. Point it at the API login (see .env.example) and ' +
        'MIGRATION_DATABASE_URL at the owner.',
    );
  }
  if (password === '') {
    throw new Error('DATABASE_URL has no password');
  }

  const db = createDb(ownerUrl);
  try {
    const { rows } = await sql<{ found: boolean }>`
      select exists (select from pg_roles where rolname = ${user}) as found
    `.execute(db);
    const found = rows[0]?.found === true;
    await sql`
      ${sql.raw(found ? 'alter' : 'create')} role ${sql.id(user)}
      login nosuperuser nobypassrls password ${sql.lit(password)}
    `.execute(db);
    await sql`grant ${sql.id(APP_ROLE)} to ${sql.id(user)}`.execute(db);
    logger.log(`${found ? 'Updated' : 'Created'} login role ${user}, member of ${APP_ROLE}`);
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
