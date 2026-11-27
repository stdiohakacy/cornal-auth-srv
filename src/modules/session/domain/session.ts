import { AggregateRoot } from '#src/shared/domain/aggregate-root.js';
import {
  createEvent,
  type DomainEvent,
} from '#src/shared/domain/domain-event.js';
import { newId, type Id } from '#src/shared/domain/id.js';
import { err, ok, type Result } from '#src/shared/domain/result.js';
import { SESSION_POLICY } from './session-policy.js';
import { RefreshConflictError, SessionInvalidError } from './session.errors.js';

export type SessionId = Id<'Session'>;
export type RevokeReason =
  'logout' | 'reuse_detected' | 'user_inactive' | 'admin' | 'password_changed';

export type SessionEvent =
  | DomainEvent<'session.started', { userId: string }>
  | DomainEvent<'session.revoked', { userId: string; reason: RevokeReason }>
  | DomainEvent<'session.refresh_reuse_detected', { userId: string }>;

export type SessionProps = {
  userId: string;
  /** sha256 (hex) of the current refresh secret; the raw secret is never stored. */
  refreshHash: string;
  /** Previous hashes, newest first (max 5): presenting one again means the family leaked. */
  prevRefreshHashes: readonly string[];
  rotatedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revokeReason: RevokeReason | null;
  amr: readonly string[];
  authTime: Date;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  /** Organization the access tokens of this session are scoped to (null = none selected). */
  activeOrgId: string | null;
};

const minDate = (a: Date, b: Date): Date => (a < b ? a : b);

/** One refresh-token family. Revoking it kills every token ever rotated from it. */
export class Session extends AggregateRoot<
  SessionId,
  SessionProps,
  SessionEvent
> {
  private constructor(id: SessionId, props: SessionProps, version: number) {
    super(id, props, version);
  }

  static start(input: {
    userId: string;
    refreshHash: string;
    now: Date;
    idleTtlMs: number;
    absoluteTtlMs: number;
    amr: readonly string[];
    ip: string | null;
    userAgent: string | null;
    activeOrgId?: string | null;
  }): Session {
    const absoluteExpiresAt = new Date(
      input.now.getTime() + input.absoluteTtlMs,
    );
    const session = new Session(
      newId<'Session'>(),
      {
        userId: input.userId,
        refreshHash: input.refreshHash,
        prevRefreshHashes: [],
        rotatedAt: input.now,
        idleExpiresAt: minDate(
          new Date(input.now.getTime() + input.idleTtlMs),
          absoluteExpiresAt,
        ),
        absoluteExpiresAt,
        revokedAt: null,
        revokeReason: null,
        amr: [...input.amr],
        authTime: input.now,
        ip: input.ip,
        userAgent: input.userAgent,
        createdAt: input.now,
        lastActiveAt: input.now,
        activeOrgId: input.activeOrgId ?? null,
      },
      0,
    );
    session.raise(
      createEvent({
        type: 'session.started',
        aggregateType: 'Session',
        aggregateId: session.id,
        payload: { userId: input.userId },
        occurredAt: input.now,
      }),
    );
    return session;
  }

  static reconstitute(
    id: SessionId,
    props: SessionProps,
    version: number,
  ): Session {
    return new Session(id, props, version);
  }

  get userId(): string {
    return this.props.userId;
  }

  get snapshot(): Readonly<SessionProps> {
    return this.props;
  }

  /** Membership checks happen in the use case; the session only remembers the choice. */
  selectOrganization(orgId: string | null): void {
    this.props.activeOrgId = orgId;
  }

  /** True only for the current refresh secret (logout must not accept a stale or forged one). */
  holdsRefreshHash(hash: string): boolean {
    return this.props.refreshHash === hash;
  }

  isActive(now: Date): boolean {
    return (
      this.props.revokedAt === null &&
      this.props.idleExpiresAt > now &&
      this.props.absoluteExpiresAt > now
    );
  }

  rotate(input: {
    presentedHash: string;
    nextHash: string;
    now: Date;
    idleTtlMs: number;
    ip: string | null;
    userAgent: string | null;
  }): Result<void, SessionInvalidError | RefreshConflictError> {
    const p = this.props;
    if (!this.isActive(input.now)) return err(new SessionInvalidError());

    if (input.presentedHash === p.refreshHash) {
      p.prevRefreshHashes = [p.refreshHash, ...p.prevRefreshHashes].slice(
        0,
        SESSION_POLICY.maxPreviousRefreshHashes,
      );
      p.refreshHash = input.nextHash;
      p.rotatedAt = input.now;
      p.lastActiveAt = input.now;
      p.idleExpiresAt = minDate(
        new Date(input.now.getTime() + input.idleTtlMs),
        p.absoluteExpiresAt,
      );
      p.ip = input.ip;
      p.userAgent = input.userAgent;
      return ok(undefined);
    }

    const previousIndex = p.prevRefreshHashes.indexOf(input.presentedHash);
    if (
      previousIndex === 0 &&
      input.now.getTime() - p.rotatedAt.getTime() <
        SESSION_POLICY.rotationGraceMs
    ) {
      return err(new RefreshConflictError());
    }
    if (previousIndex >= 0) {
      this.revoke('reuse_detected', input.now);
      this.raise(
        createEvent({
          type: 'session.refresh_reuse_detected',
          aggregateType: 'Session',
          aggregateId: this.id,
          payload: { userId: p.userId },
          occurredAt: input.now,
        }),
      );
      return err(new SessionInvalidError());
    }
    // Unknown secret: never revoke, or anyone who saw the session id (it is in every access
    // token) could sign the user out.
    return err(new SessionInvalidError());
  }

  revoke(reason: RevokeReason, now: Date): void {
    if (this.props.revokedAt !== null) return;
    this.props.revokedAt = now;
    this.props.revokeReason = reason;
    this.raise(
      createEvent({
        type: 'session.revoked',
        aggregateType: 'Session',
        aggregateId: this.id,
        payload: { userId: this.props.userId, reason },
        occurredAt: now,
      }),
    );
  }
}
