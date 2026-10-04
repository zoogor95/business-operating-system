// Local development only: `pnpm dev:invite <tenant-slug> <email> [owner|staff]`.
// Creates the tenant if it doesn't exist yet (sign-up and provisioning arrive in BOS-034) and
// prints an invitation link token, so you can try accepting an invitation and logging in before
// invitation emails exist (BOS-016).
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { requireEnv } from '../env';
import { IdentityService } from '../identity/identity.service';
import { PasswordService } from '../identity/password.service';
import { DatabaseService } from '../infra/database.service';
import type { MembershipRole } from './database';

const logger = new Logger('DevInvite');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const ROLES: readonly MembershipRole[] = ['owner', 'staff'];

async function main(): Promise<void> {
  const [slug, email, roleArg = 'owner'] = process.argv.slice(2);
  if (slug === undefined || email === undefined || !ROLES.includes(roleArg as MembershipRole)) {
    throw new Error('Usage: pnpm dev:invite <tenant-slug> <email> [owner|staff]');
  }
  const host = new URL(requireEnv('DATABASE_URL')).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to run against ${host}: dev:invite is for local use`);
  }

  const database = new DatabaseService();
  try {
    const tenant = await database.db
      .insertInto('tenants')
      .values({ slug, name: slug, business_type: 'optical' })
      .onConflict((oc) => oc.column('slug').doUpdateSet({ slug }))
      .returning(['id', 'name'])
      .executeTakeFirstOrThrow();

    const identity = new IdentityService(database, new PasswordService());
    const invitation = await identity.invite({
      tenantId: tenant.id,
      email,
      role: roleArg as MembershipRole,
    });

    const body = JSON.stringify({ token: invitation.token, password: 'choose-a-password' });
    logger.log(`Invited ${email} as ${roleArg} to ${tenant.name} (${tenant.id})`);
    logger.log(`Token (valid until ${invitation.expiresAt.toISOString()}): ${invitation.token}`);
    logger.log('Accept it (PowerShell), changing the password:');
    // Plain stdout (no logger prefix) so the line can be copied and run as is.
    process.stdout.write(
      '\nInvoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/invitations/accept ' +
        `-ContentType 'application/json' -Body '${body}'\n\n`,
    );
  } finally {
    await database.onModuleDestroy();
  }
}

main().catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
