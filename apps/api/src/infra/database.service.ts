import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { requireEnv } from '../env';

// Raw connection pool for now; the ORM/migration layer on top of it is BOS-004.
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  readonly pool = new Pool({
    connectionString: requireEnv('DATABASE_URL'),
    connectionTimeoutMillis: 3000,
  });

  constructor() {
    // An idle client losing its connection must not crash the process.
    this.pool.on('error', (err) => {
      this.logger.error(`Idle Postgres client error: ${err.message}`);
    });
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
