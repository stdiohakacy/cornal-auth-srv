import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import type { DomainError } from '../../../shared/domain/domain-error.js';
import { ok, type Result } from '../../../shared/domain/result.js';
import { Session } from '../domain/session.js';
import {
  type IssuedTokens,
  secondsUntil,
  type SessionTtl,
} from './issued-tokens.js';
import type {
  AccessTokenService,
  CredentialsVerifier,
  RefreshTokenFactory,
  SessionRepository,
} from './ports.js';

/**
 * Password login. Credential checks (rate limit already applied, lockout, Argon2 gate, dummy hash)
 * live in identity's façade; this starts a new refresh family and issues the first token pair.
 */
export class LoginUseCase<E extends DomainError> {
  constructor(
    private readonly credentials: CredentialsVerifier<E>,
    private readonly sessions: SessionRepository,
    private readonly refreshTokens: RefreshTokenFactory,
    private readonly accessTokens: AccessTokenService,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ttl: SessionTtl,
  ) {}

  async execute(input: {
    email: string;
    password: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<Result<IssuedTokens, E>> {
    const verified = await this.credentials.verify({
      email: input.email,
      password: input.password,
    });
    if (!verified.ok) return verified;

    const now = this.clock.now();
    const { secret, hash } = this.refreshTokens.newSecret();
    const session = Session.start({
      userId: verified.value.userId,
      refreshHash: hash,
      now,
      idleTtlMs: this.ttl.idleSeconds * 1000,
      absoluteTtlMs: this.ttl.absoluteSeconds * 1000,
      amr: ['pwd'],
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await this.uow.run(async () => {
      await this.sessions.save(session);
      return ok(undefined);
    });

    const access = await this.accessTokens.issue({
      sub: session.userId,
      sid: session.id,
      uv: verified.value.tokenVersion,
      amr: session.snapshot.amr,
      authTime: now,
    });
    return ok({
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: this.refreshTokens.format(session.id, secret),
      refreshMaxAgeSeconds: secondsUntil(now, session.snapshot.idleExpiresAt),
    });
  }
}
