import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { IdentityService, type LoginResult } from './identity.service';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.service';

/**
 * Sign-in and invitation acceptance (BOS-014). Login returns the user and their businesses;
 * the session/JWT is added in BOS-015. Request validation moves to the shared API conventions
 * in BOS-029.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly identity: IdentityService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown): Promise<LoginResult> {
    const email = stringField(body, 'email', 3, 320);
    const password = stringField(body, 'password', 1, PASSWORD_MAX_LENGTH);
    const result = await this.identity.login(email, password);
    if (!result) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return result;
  }

  @Post('invitations/accept')
  @HttpCode(200)
  acceptInvitation(@Body() body: unknown): Promise<{ userId: string; tenantId: string }> {
    const token = stringField(body, 'token', 1, 200);
    const password = stringField(body, 'password', PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH);
    const fullName = optionalStringField(body, 'fullName', 200);
    return this.identity.acceptInvitation(token, password, fullName);
  }
}

function stringField(body: unknown, key: string, min: number, max: number): string {
  const value = field(body, key);
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new BadRequestException(
      `${key} must be a string of ${String(min)} to ${String(max)} characters`,
    );
  }
  return value;
}

function optionalStringField(body: unknown, key: string, max: number): string | undefined {
  const value = field(body, key);
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > max) {
    throw new BadRequestException(`${key} must be a string of at most ${String(max)} characters`);
  }
  return value;
}

function field(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)[key]
    : undefined;
}
