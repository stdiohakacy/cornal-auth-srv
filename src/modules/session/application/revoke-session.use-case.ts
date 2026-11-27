import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import type { SessionId } from '../domain/session.js';
import { SessionNotFoundError } from '../domain/session.errors.js';
import type { SessionRepository } from './ports.js';

/** "Sign out this device". Only the owner's active sessions; anything else is SessionNotFound. */
export class RevokeSessionUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    userId: string;
    sessionId: SessionId;
  }): Promise<Result<void, SessionNotFoundError>> {
    return this.uow.run(async () => {
      const now = this.clock.now();
      const session = await this.sessions.findById(input.sessionId);
      if (
        !session ||
        session.userId !== input.userId ||
        !session.isActive(now)
      ) {
        return err(new SessionNotFoundError());
      }
      session.revoke('logout', now);
      await this.sessions.save(session);
      return ok(undefined);
    });
  }
}
