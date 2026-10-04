import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { createDb, type Database } from '../db/database';
import { requireEnv } from '../env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  // An idle client losing its connection must not crash the process.
  readonly db = createDb(requireEnv('DATABASE_URL'), (err) => {
    this.logger.error(`Idle Postgres client error: ${err.message}`);
  });

  async ping(): Promise<void> {
    await sql`select 1`.execute(this.db);
  }

  /** Runs `fn` in a transaction; it commits when `fn` resolves and rolls back if it throws. */
  transaction<T>(fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(fn);
  }

  /**
   * Runs `fn` in a transaction scoped to one tenant: `app.current_tenant` is set with
   * transaction-local semantics (`SET LOCAL`), so it is cleared on commit/rollback and never
   * leaks to the next user of the pooled connection. RLS policies read it (BOS-011).
   */
  withTenant<T>(tenantId: string, fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    if (!UUID.test(tenantId)) {
      return Promise.reject(new Error(`Invalid tenant id: ${tenantId}`));
    }
    return this.transaction(async (trx) => {
      // `SET LOCAL` cannot take a bind parameter; set_config(..., true) is the same thing.
      await sql`select set_config('app.current_tenant', ${tenantId}, true)`.execute(trx);
      return fn(trx);
    });
  }

  /**
   * Runs `fn` in a transaction on behalf of a signed-in user, before any tenant is chosen:
   * `app.current_user` is set (transaction-local) so the `member_self` policy lets them read
   * their own memberships in every tenant (BOS-014). Combine with a tenant via `withTenant`.
   */
  withUser<T>(userId: string, fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    if (!UUID.test(userId)) {
      return Promise.reject(new Error(`Invalid user id: ${userId}`));
    }
    return this.transaction(async (trx) => {
      await sql`select set_config('app.current_user', ${userId}, true)`.execute(trx);
      return fn(trx);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }
}
