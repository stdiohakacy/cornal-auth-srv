import { Module } from '@nestjs/common';
import { ThrottlingModule } from '../../shared/infrastructure/throttling/throttling.module.js';
import { AccessTokenGuard } from './presentation/access-token.guard.js';
import { JwksController } from './presentation/jwks.controller.js';
import { SessionController } from './presentation/session.controller.js';
import { SessionCoreModule } from './session-core.module.js';

/** `login` role: /auth login, refresh, logout, session + the JWKS. */
@Module({
  imports: [SessionCoreModule, ThrottlingModule],
  controllers: [SessionController, JwksController],
  providers: [AccessTokenGuard],
  exports: [AccessTokenGuard, SessionCoreModule],
})
export class SessionHttpModule {}

/** `api` role: JWKS + AccessTokenGuard for protected /iam routes (Phase 4b+). */
@Module({
  imports: [SessionCoreModule],
  controllers: [JwksController],
  providers: [AccessTokenGuard],
  exports: [AccessTokenGuard, SessionCoreModule],
})
export class SessionApiModule {}
