import type { Clock, UnitOfWork } from '#src/shared/application/ports.js';
import { ok, type Result } from '#src/shared/domain/result.js';
import type { RefreshTokenFactory, SessionRepository } from './ports.js';

/** Idempotent: unknown, expired or forged tokens still answer ok (and change nothing). */
export class LogoutUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly refreshTokens: RefreshTokenFactory,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: { refreshToken: string }): Promise<Result<void, never>> {
    const parsed = this.refreshTokens.parse(input.refreshToken);
    if (!parsed) return ok(undefined);
    return this.uow.run(async () => {
      const session = await this.sessions.findById(parsed.sessionId);
      if (session?.holdsRefreshHash(parsed.hash)) {
        session.revoke('logout', this.clock.now());
        await this.sessions.save(session);
      }
      return ok(undefined);
    });
  }
}
