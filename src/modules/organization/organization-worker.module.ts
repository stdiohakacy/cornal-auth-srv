import { Module } from '@nestjs/common';
import { IdentityCoreModule } from '../identity/identity-core.module.js';
import { OrganizationInvitationConsumer } from './infrastructure/organization-invitation.consumer.js';

/** `worker` role: outbox consumers for organization events. */
@Module({
  imports: [IdentityCoreModule],
  providers: [OrganizationInvitationConsumer],
})
export class OrganizationWorkerModule {}
