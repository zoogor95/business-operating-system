// Migration CLI: `pnpm db:migrate`, `pnpm db:rollback`, `pnpm db:status` from the repo root.
// Built output runs the same way: `node dist/db/migrate.js <command>`.
import { Logger } from '@nestjs/common';
import { type MigrationResultSet, Migrator } from 'kysely/migration';
import { requireEnv } from '../env';
import { createDb } from './database';
import { migrations } from './migrations';

const COMMANDS = ['latest', 'up', 'down', 'status'] as const;
type Command = (typeof COMMANDS)[number];

const logger = new Logger('Migrate');

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!isCommand(command)) {
    throw new Error(`Usage: migrate <${COMMANDS.join('|')}>`);
  }

  const db = createDb(requireEnv('DATABASE_URL'));
  const migrator = new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(migrations) },
  });

  try {
    if (command === 'status') {
      for (const m of await migrator.getMigrations()) {
        logger.log(
          `${m.executedAt ? `applied ${m.executedAt.toISOString()}` : 'pending'}  ${m.name}`,
        );
      }
      return;
    }
    const run = {
      latest: () => migrator.migrateToLatest(),
      up: () => migrator.migrateUp(),
      down: () => migrator.migrateDown(),
    }[command];
    report(await run());
  } finally {
    await db.destroy();
  }
}

function report({ error, results = [] }: MigrationResultSet): void {
  for (const r of results) {
    const line = `${r.direction === 'Up' ? '↑' : '↓'} ${r.migrationName}: ${r.status}`;
    if (r.status === 'Error') {
      logger.error(line);
    } else {
      logger.log(line);
    }
  }
  if (error) {
    throw error instanceof Error ? error : new Error('Migration failed', { cause: error });
  }
  if (results.length === 0) {
    logger.log('Nothing to do');
  }
}

function isCommand(value: string | undefined): value is Command {
  return COMMANDS.includes(value as Command);
}

main().catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
