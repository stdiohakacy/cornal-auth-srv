import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import { ConcurrencyConflictError } from '../../../shared/domain/concurrency-conflict.error.js';
import type { Session } from '../domain/session.js';
import {
  RefreshConflictError,
  SessionInvalidError,
} from '../domain/session.errors.js';
import {
  type IssuedTokens,
  secondsUntil,
  type SessionTtl,
} from './issued-tokens.js';
import type {
  AccessTokenService,
  RefreshTokenFactory,
  SessionRepository,
  UserAuthStateReader,
} from './ports.js';

type Outcome =
  | {
      readonly kind: 'rotated';
      readonly session: Session;
      readonly secret: string;
      readonly tokenVersion: number;
    }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'conflict' };

/**
 * Refresh-token rotation. Revocations (reuse detected, user no longer allowed) are COMMITTED: the
 * transaction returns ok and the error is produced afterwards — an err() would roll them back.
 */
export class RefreshSessionUseCase {
  constructor(
    private readonly authState: UserAuthStateReader,
    private readonly sessions: SessionRepository,
    private readonly refreshTokens: RefreshTokenFactory,
    private readonly accessTokens: AccessTokenService,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ttl: SessionTtl,
  ) {}

  async execute(input: {
    refreshToken: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<
    Result<IssuedTokens, SessionInvalidError | RefreshConflictError>
  > {
    const parsed = this.refreshTokens.parse(input.refreshToken);
    if (!parsed) return err(new SessionInvalidError());
    const now = this.clock.now();

    let outcome: Outcome;
    try {
      const result = await this.uow.run(
        async (): Promise<Result<Outcome, never>> => {
          const session = await this.sessions.findById(parsed.sessionId);
          if (!session) return ok({ kind: 'invalid' });

          const state = await this.authState.get(session.userId);
          if (!state?.canAuthenticate) {
            session.revoke('user_inactive', now);
            await this.saveIfChanged(session);
            return ok({ kind: 'invalid' });
          }

          const next = this.refreshTokens.newSecret();
          const rotated = session.rotate({
            presentedHash: parsed.hash,
            nextHash: next.hash,
            now,
            idleTtlMs: this.ttl.idleSeconds * 1000,
            ip: input.ip,
            userAgent: input.userAgent,
          });
          if (!rotated.ok) {
            await this.saveIfChanged(session); // persists a reuse revocation
            return ok({
              kind:
                rotated.error instanceof RefreshConflictError
                  ? 'conflict'
                  : 'invalid',
            });
          }
          await this.sessions.save(session);
          return ok({
            kind: 'rotated',
            session,
            secret: next.secret,
            tokenVersion: state.tokenVersion,
          });
        },
      );
      if (!result.ok) return result; // never: the work only returns ok
      outcome = result.value;
    } catch (error) {
      if (error instanceof ConcurrencyConflictError)
        return err(new RefreshConflictError());
      throw error;
    }

    if (outcome.kind === 'conflict') return err(new RefreshConflictError());
    if (outcome.kind === 'invalid') return err(new SessionInvalidError());

    const { session, secret, tokenVersion } = outcome;
    const access = await this.accessTokens.issue({
      sub: session.userId,
      sid: session.id,
      uv: tokenVersion,
      amr: session.snapshot.amr,
      authTime: session.snapshot.authTime,
    });
    return ok({
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: this.refreshTokens.format(session.id, secret),
      refreshMaxAgeSeconds: secondsUntil(now, session.snapshot.idleExpiresAt),
    });
  }

  /** Domain operations that change state also raise events; nothing raised ⇒ nothing to write. */
  private async saveIfChanged(session: Session): Promise<void> {
    if (session.pendingEvents.length > 0) await this.sessions.save(session);
  }
}
