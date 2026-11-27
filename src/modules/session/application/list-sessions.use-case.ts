import type { Clock } from '#src/shared/application/ports.js';
import type { SessionRepository } from './ports.js';

/** Device list row. The raw User-Agent is returned; the frontend renders it (no AGPL parser here). */
export type SessionView = {
  readonly id: string;
  readonly current: boolean;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly ip: string | null;
  readonly userAgent: string | null;
};

export class ListSessionsUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    userId: string;
    currentSessionId: string;
  }): Promise<SessionView[]> {
    const active = await this.sessions.listActiveByUser(
      input.userId,
      this.clock.now(),
    );
    return active.map((session) => ({
      id: session.id,
      current: session.id === input.currentSessionId,
      createdAt: session.snapshot.createdAt,
      lastActiveAt: session.snapshot.lastActiveAt,
      ip: session.snapshot.ip,
      userAgent: session.snapshot.userAgent,
    }));
  }
}
