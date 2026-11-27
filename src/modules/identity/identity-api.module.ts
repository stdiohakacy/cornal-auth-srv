import { Module } from '@nestjs/common';
import { ThrottlingModule } from '../../shared/infrastructure/throttling/throttling.module.js';
import { SessionGuardModule } from '../session/session-guard.module.js';
import { IdentityCoreModule } from './identity-core.module.js';
import { MePasswordController } from './presentation/me-password.controller.js';

/** `api` role: the signed-in user's identity endpoints. */
@Module({
  imports: [IdentityCoreModule, SessionGuardModule, ThrottlingModule],
  controllers: [MePasswordController],
})
export class IdentityApiModule {}
