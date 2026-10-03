import { Controller, Get } from '@nestjs/common';
import {
  ALL_MODULES,
  type DependencyHealth,
  type HealthDependency,
  type HealthResponse,
} from '@bos/shared';
import { DatabaseService } from '../infra/database.service';
import { MailService } from '../infra/mail.service';
import { RedisService } from '../infra/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const [postgres, redis, mail] = await Promise.all([
      probe(() => this.db.ping()),
      probe(() => this.redis.ping()),
      probe(() => this.mail.ping()),
    ]);
    const dependencies: Record<HealthDependency, DependencyHealth> = { postgres, redis, mail };

    return {
      status: Object.values(dependencies).every((d) => d.status === 'up') ? 'ok' : 'degraded',
      service: 'bos-api',
      version: process.env['npm_package_version'] ?? '0.0.0',
      time: new Date().toISOString(),
      dependencies,
      knownModules: ALL_MODULES,
    };
  }
}

async function probe(ping: () => Promise<void>): Promise<DependencyHealth> {
  const started = performance.now();
  try {
    await ping();
    return { status: 'up', latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    return { status: 'down', error: err instanceof Error ? err.message : String(err) };
  }
}
