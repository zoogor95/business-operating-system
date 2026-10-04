import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { IdentityModule } from './identity/identity.module';
import { InfraModule } from './infra/infra.module';

@Module({
  imports: [InfraModule, IdentityModule],
  controllers: [HealthController],
})
export class AppModule {}
