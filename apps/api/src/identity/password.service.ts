import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// argon2id (the library default) with OWASP's minimum recommended cost: 19 MiB, 2 passes.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  /** False for a wrong password and for a malformed hash; never throws. */
  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Spends the same time as a real check when there is no user or no password, so response
   * times don't reveal which emails have accounts.
   */
  async verifyAgainstDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('not-a-real-password-for-timing-only');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
