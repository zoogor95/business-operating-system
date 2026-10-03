import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { requireEnv } from '../env';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private lastError: string | undefined;

  readonly client = new Redis(requireEnv('REDIS_URL'), {
    // Fail commands fast while disconnected instead of queueing them forever.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

  constructor() {
    // ioredis emits an error on every reconnect attempt; log each distinct one once.
    this.client.on('error', (err: Error) => {
      if (err.message !== this.lastError) {
        this.lastError = err.message;
        this.logger.error(`Redis error: ${err.message}`);
      }
    });
    this.client.on('ready', () => {
      this.lastError = undefined;
    });
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
