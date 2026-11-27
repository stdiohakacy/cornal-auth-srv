import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  SessionIdParamSchema,
  type SessionListResponse,
} from '../../../contracts/session.schemas.js';
import { unwrap } from '../../../shared/infrastructure/http/unwrap.js';
import { AppThrottlerGuard } from '../../../shared/infrastructure/throttling/app-throttler.guard.js';
import { RATE_LIMITS } from '../../../shared/infrastructure/throttling/rate-limits.js';
import { ListSessionsUseCase } from '../application/list-sessions.use-case.js';
import type { AccessClaims } from '../application/ports.js';
import { RevokeAllSessionsUseCase } from '../application/revoke-all-sessions.use-case.js';
import { RevokeSessionUseCase } from '../application/revoke-session.use-case.js';
import type { SessionId } from '../domain/session.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { CurrentAuth } from './current-auth.decorator.js';

/** The signed-in user's devices (`api` role). */
@Controller('iam/me/sessions')
@UseGuards(AppThrottlerGuard, AccessTokenGuard)
@Throttle(RATE_LIMITS.meSessions)
@SkipThrottle({ email: true, ipEmail: true })
export class MeSessionsController {
  constructor(
    private readonly listSessions: ListSessionsUseCase,
    private readonly revokeSession: RevokeSessionUseCase,
    private readonly revokeAllSessions: RevokeAllSessionsUseCase,
  ) {}

  @Get()
  async list(@CurrentAuth() auth: AccessClaims): Promise<SessionListResponse> {
    const sessions = await this.listSessions.execute({
      userId: auth.sub,
      currentSessionId: auth.sid,
    });
    return {
      sessions: sessions.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        lastActiveAt: s.lastActiveAt.toISOString(),
      })),
    };
  }

  /** "Sign out of all other devices": the caller's session stays signed in. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOthers(@CurrentAuth() auth: AccessClaims): Promise<void> {
    unwrap(
      await this.revokeAllSessions.execute({
        userId: auth.sub,
        reason: 'logout',
        exceptSessionId: auth.sid,
      }),
    );
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOne(
    @CurrentAuth() auth: AccessClaims,
    @Param('sessionId', { schema: SessionIdParamSchema }) sessionId: string,
  ): Promise<void> {
    // The schema guarantees a UUID; ownership is checked by the use case.
    unwrap(
      await this.revokeSession.execute({
        userId: auth.sub,
        sessionId: sessionId as SessionId,
      }),
    );
  }
}
