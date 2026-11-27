import type { Clock, UnitOfWork } from '#src/shared/application/ports.js';
import type { DomainError } from '#src/shared/domain/domain-error.js';
import { ok, type Result } from '#src/shared/domain/result.js';
import { Session } from '../domain/session.js';
import {
  absoluteTtlMs,
  idleTtlMs,
  type IssuedTokens,
  issueTokenPair,
  type SessionTtl,
} from './issued-tokens.js';
import {
  type AccessTokenService,
  type CredentialsVerifier,
  orgAllowedFor,
  type OrgContextReader,
  type RefreshTokenFactory,
  type SessionRepository,
} from './ports.js';

const AMR = ['pwd'] as const;

/**
 * Password login. Credential checks (rate limit, lockout, Argon2 gate, dummy hash) live in
 * identity's façade; this starts a refresh family scoped to the user's default organization
 * (most recently used, or the only one) and issues the first token pair.
 */
export class LoginUseCase<E extends DomainError> {
  constructor(
    private readonly credentials: CredentialsVerifier<E>,
    private readonly sessions: SessionRepository,
    private readonly refreshTokens: RefreshTokenFactory,
    private readonly accessTokens: AccessTokenService,
    private readonly orgs: OrgContextReader,
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
    const { userId, tokenVersion } = verified.value;

    const preferred = await this.sessions.lastActiveOrgOf(userId);
    const candidate = await this.orgs.defaultFor(userId, preferred);
    const org =
      candidate && orgAllowedFor(candidate, AMR) ? candidate : undefined;

    const now = this.clock.now();
    const { secret, hash } = this.refreshTokens.newSecret();
    const session = Session.start({
      userId,
      refreshHash: hash,
      now,
      idleTtlMs: idleTtlMs(this.ttl),
      absoluteTtlMs: absoluteTtlMs(this.ttl),
      amr: AMR,
      ip: input.ip,
      userAgent: input.userAgent,
      activeOrgId: org?.orgId ?? null,
    });
    await this.uow.run(async () => {
      await this.sessions.save(session);
      return ok(undefined);
    });

    return ok(
      await issueTokenPair(
        { access: this.accessTokens, refresh: this.refreshTokens },
        { session, tokenVersion, org, secret, now },
      ),
    );
  }
}
