import { Module } from '@nestjs/common';
import { ThrottlingModule } from '#src/shared/infrastructure/throttling/throttling.module.js';
import { IdentityCoreModule } from './identity-core.module.js';
import { IdentityController } from './presentation/identity.controller.js';

/** `login` role: public /auth identity endpoints. */
@Module({
  imports: [IdentityCoreModule, ThrottlingModule],
  controllers: [IdentityController],
})
export class IdentityHttpModule {}
