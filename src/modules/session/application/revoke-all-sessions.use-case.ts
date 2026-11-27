import type { Clock, UnitOfWork } from '#src/shared/application/ports.js';
import { ok, type Result } from '#src/shared/domain/result.js';
import type { RevokeReason } from '../domain/session.js';
import type { SessionRepository } from './ports.js';

/** Revokes every active session of a user (optionally keeping one, e.g. the caller's). */
export class RevokeAllSessionsUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    userId: string;
    reason: RevokeReason;
    exceptSessionId?: string;
  }): Promise<Result<{ revoked: number }, never>> {
    return this.uow.run(async () => {
      const now = this.clock.now();
      const targets = (
        await this.sessions.listActiveByUser(input.userId, now)
      ).filter((session) => session.id !== input.exceptSessionId);
      for (const session of targets) {
        session.revoke(input.reason, now);
        await this.sessions.save(session);
      }
      return ok({ revoked: targets.length });
    });
  }
}
