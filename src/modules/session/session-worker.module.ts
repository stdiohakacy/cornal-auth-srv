import { Module } from '@nestjs/common';
import { SessionRevocationConsumer } from './infrastructure/session-revocation.consumer.js';
import { SessionCoreModule } from './session-core.module.js';

/** `worker` role: session reactions to other modules' events. */
@Module({
  imports: [SessionCoreModule],
  providers: [SessionRevocationConsumer],
})
export class SessionWorkerModule {}
