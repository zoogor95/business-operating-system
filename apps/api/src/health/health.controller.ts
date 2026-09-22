import { Controller, Get } from '@nestjs/common';
import { ALL_MODULES, type HealthResponse } from '@bos/shared';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'bos-api',
      version: process.env.npm_package_version ?? '0.0.0',
      time: new Date().toISOString(),
      knownModules: ALL_MODULES,
    };
  }
}
