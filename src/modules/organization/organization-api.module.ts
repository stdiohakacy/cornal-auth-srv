import { Module } from '@nestjs/common';
import { SessionGuardModule } from '../session/session-guard.module.js';
import { OrganizationCoreModule } from './organization-core.module.js';
import { OrganizationsController } from './presentation/organizations.controller.js';

/** `api` role: organization creation, listings and member management. */
@Module({
  imports: [OrganizationCoreModule, SessionGuardModule],
  controllers: [OrganizationsController],
})
export class OrganizationApiModule {}
