import { Module } from '@nestjs/common';
import { IdentityCoreModule } from './identity-core.module.js';
import { IdentityEmailConsumer } from './infrastructure/identity-email.consumer.js';

/** `worker` role: outbox consumers for identity events. */
@Module({
  imports: [IdentityCoreModule],
  providers: [IdentityEmailConsumer],
})
export class IdentityWorkerModule {}
