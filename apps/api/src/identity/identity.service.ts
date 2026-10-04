import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { MembershipRole } from '../db/database';
import { DatabaseService } from '../infra/database.service';
import { createInvitationToken, INVITATION_TTL_MS, parseInvitationToken } from './invitation-token';
import { PasswordService } from './password.service';

export interface InviteInput {
  tenantId: string;
  email: string;
  role: MembershipRole;
  fullName?: string;
  /** The user sending the invitation; null for system/CLI invitations. */
  invitedBy?: string | null;
}

export interface Invitation {
  membershipId: string;
  userId: string;
  /** Shown once (for the invitation email); only its hash is stored. */
  token: string;
  expiresAt: Date;
}

export interface MembershipSummary {
  membershipId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: MembershipRole;
}

export interface LoginResult {
  user: { id: string; email: string; fullName: string };
  /** Active memberships in businesses that are on trial or active. */
  memberships: MembershipSummary[];
}

/** Normalises an email the way `users.email` stores it. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Users, invitations and password sign-in (BOS-014). Issuing session tokens comes in BOS-015;
 * sending the invitation email in BOS-016.
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
  ) {}

  /**
   * Invites an email to a tenant. Creates the user if the email is new (an existing user keeps
   * their password and joins another business). Re-inviting someone who hasn't accepted yet
   * replaces their link.
   */
  async invite(input: InviteInput): Promise<Invitation> {
    const email = normalizeEmail(input.email);
    const { token, secretHash } = createInvitationToken(input.tenantId);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    return this.database.withTenant(input.tenantId, async (trx) => {
      const user = await trx
        .insertInto('users')
        .values({ email, full_name: input.fullName?.trim() ?? '' })
        .onConflict((oc) => oc.column('email').doUpdateSet({ email }))
        .returning('id')
        .executeTakeFirstOrThrow();

      const existing = await trx
        .selectFrom('tenant_memberships')
        .select(['id', 'status'])
        .where('user_id', '=', user.id)
        .executeTakeFirst();

      if (existing && existing.status !== 'invited') {
        throw new ConflictException(`${email} is already a member of this business`);
      }

      const membership = existing
        ? await trx
            .updateTable('tenant_memberships')
            .set({
              role: input.role,
              invite_token_hash: secretHash,
              invite_expires_at: expiresAt,
              invited_by: input.invitedBy ?? null,
              updated_by: input.invitedBy ?? null,
            })
            .where('id', '=', existing.id)
            .returning('id')
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto('tenant_memberships')
            .values({
              tenant_id: input.tenantId,
              user_id: user.id,
              role: input.role,
              invite_token_hash: secretHash,
              invite_expires_at: expiresAt,
              invited_by: input.invitedBy ?? null,
              created_by: input.invitedBy ?? null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();

      return { membershipId: membership.id, userId: user.id, token, expiresAt };
    });
  }

  /**
   * Accepts an invitation. A new user sets their password here; a user who already has one
   * (from another business) must enter it, so a leaked link can't take over their account.
   */
  async acceptInvitation(
    token: string,
    password: string,
    fullName?: string,
  ): Promise<{ userId: string; tenantId: string }> {
    const parsed = parseInvitationToken(token);
    if (!parsed) {
      throw new BadRequestException('This invitation link is invalid or has expired');
    }

    // Hash outside the transaction: argon2 is deliberately slow.
    const invitation = await this.database.withTenant(parsed.tenantId, (trx) =>
      trx
        .selectFrom('tenant_memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select(['m.id as membershipId', 'u.id as userId', 'u.password_hash as passwordHash'])
        .where('m.invite_token_hash', '=', parsed.secretHash)
        .where('m.status', '=', 'invited')
        .where('m.invite_expires_at', '>', new Date())
        .executeTakeFirst(),
    );
    if (!invitation) {
      throw new BadRequestException('This invitation link is invalid or has expired');
    }

    const newHash =
      invitation.passwordHash === null ? await this.passwords.hash(password) : undefined;
    if (
      invitation.passwordHash !== null &&
      !(await this.passwords.verify(invitation.passwordHash, password))
    ) {
      throw new UnauthorizedException(
        'You already have a BOS account: enter your existing password to join this business',
      );
    }

    await this.database.withTenant(parsed.tenantId, async (trx) => {
      const accepted = await trx
        .updateTable('tenant_memberships')
        .set({
          status: 'active',
          invite_token_hash: null,
          invite_expires_at: null,
          updated_by: invitation.userId,
        })
        .where('id', '=', invitation.membershipId)
        .where('invite_token_hash', '=', parsed.secretHash)
        .returning('id')
        .executeTakeFirst();
      if (!accepted) {
        // Accepted or re-issued in the meantime.
        throw new BadRequestException('This invitation link is invalid or has expired');
      }
      await trx
        .updateTable('users')
        .set({
          ...(newHash === undefined ? {} : { password_hash: newHash }),
          ...(fullName?.trim() ? { full_name: fullName.trim() } : {}),
          // They received the link at this address.
          email_verified_at: new Date(),
        })
        .where('id', '=', invitation.userId)
        .execute();
    });

    return { userId: invitation.userId, tenantId: parsed.tenantId };
  }

  /** Checks an email and password; `null` when they don't match (without saying which part). */
  async login(email: string, password: string): Promise<LoginResult | null> {
    const user = await this.database.db
      .selectFrom('users')
      .select(['id', 'email', 'full_name', 'password_hash'])
      .where('email', '=', normalizeEmail(email))
      .executeTakeFirst();

    if (!user?.password_hash) {
      await this.passwords.verifyAgainstDummy(password);
      return null;
    }
    if (!(await this.passwords.verify(user.password_hash, password))) {
      return null;
    }

    await this.database.db
      .updateTable('users')
      .set({ last_login_at: new Date() })
      .where('id', '=', user.id)
      .execute();

    const memberships = await this.database.withUser(user.id, (trx) =>
      trx
        .selectFrom('tenant_memberships as m')
        .innerJoin('tenants as t', 't.id', 'm.tenant_id')
        .select([
          'm.id as membershipId',
          'm.tenant_id as tenantId',
          't.slug as tenantSlug',
          't.name as tenantName',
          'm.role as role',
        ])
        .where('m.user_id', '=', user.id)
        .where('m.status', '=', 'active')
        .where('t.status', 'in', ['trial', 'active'])
        .orderBy('t.name')
        .execute(),
    );

    return { user: { id: user.id, email: user.email, fullName: user.full_name }, memberships };
  }
}
