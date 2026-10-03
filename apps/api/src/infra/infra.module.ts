import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { MailService } from './mail.service';
import { RedisService } from './redis.service';

/** Connections to the backing services started by `docker compose up`. */
@Global()
@Module({
  providers: [DatabaseService, RedisService, MailService],
  exports: [DatabaseService, RedisService, MailService],
})
export class InfraModule {}
