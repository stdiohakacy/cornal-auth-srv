import { Module } from '@nestjs/common';
import { ThrottlingModule } from '../../shared/infrastructure/throttling/throttling.module.js';
import { MeSessionsController } from './presentation/me-sessions.controller.js';
import { SessionController } from './presentation/session.controller.js';
import { JwksModule, SessionGuardModule } from './session-guard.module.js';

/** `login` role: /auth login, refresh, logout, session + the JWKS. */
@Module({
  imports: [SessionGuardModule, JwksModule, ThrottlingModule],
  controllers: [SessionController],
})
export class SessionHttpModule {}

/** `api` role: the signed-in user's devices + the JWKS. */
@Module({
  imports: [SessionGuardModule, JwksModule, ThrottlingModule],
  controllers: [MeSessionsController],
})
export class SessionApiModule {}
