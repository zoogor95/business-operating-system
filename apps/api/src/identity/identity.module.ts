import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { IdentityService } from './identity.service';
import { PasswordService } from './password.service';

/** Users, memberships, invitations and sign-in (BOS-014). */
@Module({
  controllers: [AuthController],
  providers: [IdentityService, PasswordService],
  exports: [IdentityService],
})
export class IdentityModule {}
