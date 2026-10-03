import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { InfraModule } from './infra/infra.module';

@Module({
  imports: [InfraModule],
  controllers: [HealthController],
})
export class AppModule {}
