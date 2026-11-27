import { Module } from '@nestjs/common';
import { AccessTokenGuard } from './presentation/access-token.guard.js';
import { JwksController } from './presentation/jwks.controller.js';
import { SessionCoreModule } from './session-core.module.js';

/** AccessTokenGuard for any module with protected routes (identity /iam/me, session /iam/me/sessions). */
@Module({
  imports: [SessionCoreModule],
  providers: [AccessTokenGuard],
  exports: [AccessTokenGuard, SessionCoreModule],
})
export class SessionGuardModule {}

/** Public JWKS. Its own module so roles composed together register the route once. */
@Module({
  imports: [SessionCoreModule],
  controllers: [JwksController],
})
export class JwksModule {}
