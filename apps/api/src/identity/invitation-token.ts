import { createHash, randomBytes } from 'node:crypto';

// An invitation token is `<tenant id>.<secret>`. The tenant id lets acceptance open that
// tenant's context (RLS) before looking the invitation up; only a SHA-256 of the secret is
// stored, so a database leak doesn't leak usable links.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/** How long an invitation link works. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createInvitationToken(tenantId: string): { token: string; secretHash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { token: `${tenantId}.${secret}`, secretHash: hashSecret(secret) };
}

/** `undefined` when the token isn't in the expected shape. */
export function parseInvitationToken(
  token: string,
): { tenantId: string; secretHash: string } | undefined {
  const [tenantId, secret, ...rest] = token.trim().split('.');
  if (tenantId === undefined || secret === undefined || rest.length > 0) {
    return undefined;
  }
  if (!UUID.test(tenantId) || !SECRET.test(secret)) {
    return undefined;
  }
  return { tenantId: tenantId.toLowerCase(), secretHash: hashSecret(secret) };
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
