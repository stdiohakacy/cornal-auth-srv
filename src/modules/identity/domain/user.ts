import { AggregateRoot } from '../../../shared/domain/aggregate-root.js';
import {
  createEvent,
  type DomainEvent,
} from '../../../shared/domain/domain-event.js';
import { newId, type Id } from '../../../shared/domain/id.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import type { Email } from './email.js';
import {
  AccountLockedError,
  InvalidCredentialsError,
} from './identity.errors.js';

export type UserId = Id<'User'>;
export type UserStatus = 'active' | 'locked' | 'disabled';

export type UserEvent =
  | DomainEvent<'identity.user.registered', { email: string }>
  | DomainEvent<'identity.user.email_verified', Record<string, never>>
  | DomainEvent<'identity.user.locked', { until: string }>
  | DomainEvent<'identity.user.registration_attempted', Record<string, never>>;

export type UserProps = {
  email: Email;
  emailVerifiedAt: Date | null;
  /** Opaque PHC string from the PasswordHasher port; null for social-only accounts (Phase 9). */
  passwordHash: string | null;
  status: UserStatus;
  lockedUntil: Date | null;
  /** Bumped to invalidate every access token of the user (Phase 6 revocation). */
  tokenVersion: number;
  createdAt: Date;
};

export class User extends AggregateRoot<UserId, UserProps, UserEvent> {
  private constructor(id: UserId, props: UserProps, version: number) {
    super(id, props, version);
  }

  static register(input: {
    email: Email;
    passwordHash: string;
    now: Date;
  }): User {
    const user = new User(
      newId<'User'>(),
      {
        email: input.email,
        emailVerifiedAt: null,
        passwordHash: input.passwordHash,
        status: 'active',
        lockedUntil: null,
        tokenVersion: 0,
        createdAt: input.now,
      },
      0,
    );
    user.raise(
      createEvent({
        type: 'identity.user.registered',
        aggregateType: 'User',
        aggregateId: user.id,
        payload: { email: input.email.value },
        occurredAt: input.now,
      }),
    );
    return user;
  }

  static reconstitute(id: UserId, props: UserProps, version: number): User {
    return new User(id, props, version);
  }

  get email(): Email {
    return this.props.email;
  }
  get emailVerifiedAt(): Date | null {
    return this.props.emailVerifiedAt;
  }
  get passwordHash(): string | null {
    return this.props.passwordHash;
  }
  get status(): UserStatus {
    return this.props.status;
  }
  get lockedUntil(): Date | null {
    return this.props.lockedUntil;
  }
  get tokenVersion(): number {
    return this.props.tokenVersion;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }

  verifyEmail(now: Date): void {
    if (this.props.emailVerifiedAt !== null) return;
    this.props.emailVerifiedAt = now;
    this.raise(
      createEvent({
        type: 'identity.user.email_verified',
        aggregateType: 'User',
        aggregateId: this.id,
        payload: {},
        occurredAt: now,
      }),
    );
  }

  /**
   * Someone tried to register with this account's email. The caller answers exactly as for a new
   * account (no enumeration); the owner is told by email instead.
   */
  noteRegistrationAttempt(now: Date): void {
    this.raise(
      createEvent({
        type: 'identity.user.registration_attempted',
        aggregateType: 'User',
        aggregateId: this.id,
        payload: {},
        occurredAt: now,
      }),
    );
  }

  /** Checked before hashing, so a locked account never costs an Argon2 run. */
  ensureCanAttemptLogin(
    now: Date,
  ): Result<void, AccountLockedError | InvalidCredentialsError> {
    if (this.props.status === 'disabled')
      return err(new InvalidCredentialsError());
    const { lockedUntil } = this.props;
    if (
      this.props.status === 'locked' &&
      lockedUntil !== null &&
      lockedUntil > now
    ) {
      return err(new AccountLockedError(lockedUntil));
    }
    return ok(undefined);
  }

  lock(now: Date, durationMs: number): void {
    const until = new Date(now.getTime() + durationMs);
    this.props.status = 'locked';
    this.props.lockedUntil = until;
    this.raise(
      createEvent({
        type: 'identity.user.locked',
        aggregateType: 'User',
        aggregateId: this.id,
        payload: { until: until.toISOString() },
        occurredAt: now,
      }),
    );
  }

  /** Returns true when an expired lock was cleared (the caller persists the change). */
  clearExpiredLock(now: Date): boolean {
    const { lockedUntil } = this.props;
    if (
      this.props.status !== 'locked' ||
      lockedUntil === null ||
      lockedUntil > now
    )
      return false;
    this.props.status = 'active';
    this.props.lockedUntil = null;
    return true;
  }
}
