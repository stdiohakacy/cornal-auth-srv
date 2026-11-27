import type { Result } from '#src/shared/domain/result.js';
import type { ServiceBusyError } from '#src/shared/domain/service-busy.error.js';
import type { Email } from '../domain/email.js';
import type { User, UserId } from '../domain/user.js';

export const LOGIN_ATTEMPT_COUNTER = Symbol('LOGIN_ATTEMPT_COUNTER');
/**
 * Failed-login counter kept outside PostgreSQL so credential stuffing cannot storm `users`.
 * Unavailable storage is ServiceBusyError, never "no failures": lockout fails closed.
 */
export interface LoginAttemptCounter {
  /** Failures in the current window, including this one. */
  registerFailure(userId: UserId): Promise<Result<number, ServiceBusyError>>;
  reset(userId: UserId): Promise<Result<void, ServiceBusyError>>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
export interface UserRepository {
  findById(id: UserId): Promise<User | undefined>;
  findByEmail(email: Email): Promise<User | undefined>;
  /** Batch lookup for listings (one query). Unknown ids are absent from the map. */
  emailsByIds(ids: readonly UserId[]): Promise<ReadonlyMap<UserId, string>>;
  /**
   * Insert or optimistic update; only events are written for a version bump on existing rows.
   * Throws EmailTakenError on a duplicate email.
   */
  save(user: User): Promise<void>;
}

export type TokenPurpose = 'email_verify' | 'password_reset' | 'org_invite';

export const ONE_TIME_TOKEN_REPOSITORY = Symbol('ONE_TIME_TOKEN_REPOSITORY');
/** Single-use secrets stored as sha256 (hex). The raw value never reaches the database. */
export interface OneTimeTokenRepository {
  issue(input: {
    purpose: TokenPurpose;
    userId: UserId;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  revokeOpen(userId: UserId, purpose: TokenPurpose): Promise<void>;
  /** Read-only check (no consume): lets callers reject bad tokens before expensive work. */
  findValid(
    purpose: TokenPurpose,
    tokenHash: string,
    now: Date,
  ): Promise<{ userId: UserId } | undefined>;
  /** Atomic: returns the owner once; undefined if unknown, used, revoked or expired. */
  consume(
    purpose: TokenPurpose,
    tokenHash: string,
    now: Date,
  ): Promise<{ userId: UserId } | undefined>;

  /** Organization invitations: no user yet (user_id NULL); the payload carries the target. */
  issueOrgInvite(input: {
    tokenHash: string;
    payload: OrgInvitePayload;
    expiresAt: Date;
  }): Promise<void>;
  revokeOpenOrgInvites(orgId: string, email: string): Promise<void>;
  /** Atomic; only when the invited email equals `email` (case-insensitive). */
  consumeOrgInvite(
    tokenHash: string,
    email: string,
    now: Date,
  ): Promise<OrgInvitePayload | undefined>;
  listOpenOrgInvites(orgId: string, now: Date): Promise<OpenOrgInvite[]>;
  /** True when an open invite was revoked. */
  revokeOrgInvite(orgId: string, invitationId: string): Promise<boolean>;
}

export type OrgInvitePayload = {
  readonly invitationId: string;
  readonly orgId: string;
  readonly email: string;
  readonly roleIds: readonly string[];
  readonly invitedBy: string;
};

export type OpenOrgInvite = OrgInvitePayload & {
  readonly expiresAt: Date;
  readonly createdAt: Date;
};

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
/** Hashing is admission-controlled: a saturated pod answers ServiceBusyError instead of queueing. */
export interface PasswordHasher {
  hash(plain: string): Promise<Result<string, ServiceBusyError>>;
  verify(
    plain: string,
    encoded: string,
  ): Promise<Result<boolean, ServiceBusyError>>;
  needsRehash(encoded: string): boolean;
}

export const SECRET_TOKEN_GENERATOR = Symbol('SECRET_TOKEN_GENERATOR');
export interface SecretTokenGenerator {
  /** raw: base64url of 32 random bytes (sent to the user); hash: sha256 hex (stored). */
  generate(): { raw: string; hash: string };
  hash(raw: string): string;
}

export type EmailTemplate =
  | 'verify-email'
  | 'account-exists'
  | 'password-reset'
  | 'password-changed'
  | 'org-invitation';

export type EmailMessage = {
  readonly to: string;
  readonly template: EmailTemplate;
  readonly data: {
    readonly link: string;
    readonly orgName?: string;
    /** Lifetime of the token in `link`, stated in the email. */
    readonly expiresInMs?: number;
  };
};

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
export interface EmailSender {
  /** Throws on delivery failure so the outbox retries the message. */
  send(message: EmailMessage): Promise<void>;
}

export const BREACHED_PASSWORD_CHECKER = Symbol('BREACHED_PASSWORD_CHECKER');
/** Screens a candidate password against breach corpora. Fails open: unknown ⇒ false. */
export interface BreachedPasswordChecker {
  isBreached(plain: string): Promise<boolean>;
}
