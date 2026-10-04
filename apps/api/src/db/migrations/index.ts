import type { Migration } from 'kysely/migration';
import * as m0001 from './0001_db_helpers';
import * as m0002 from './0002_tenants';
import * as m0003 from './0003_app_role';

/**
 * Every migration, keyed by name. Kysely applies them in name order, so prefix new files
 * with the next number and register them here.
 *
 * A static list instead of Kysely's FileMigrationProvider: that one `import()`s absolute
 * paths, which breaks on Windows.
 */
export const migrations: Record<string, Migration> = {
  '0001_db_helpers': m0001,
  '0002_tenants': m0002,
  '0003_app_role': m0003,
};
