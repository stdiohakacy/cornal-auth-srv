import { Module } from '@nestjs/common';
import { SessionGuardModule } from '../session/session-guard.module.js';
import { OrganizationCoreModule } from './organization-core.module.js';
import { InvitationsController } from './presentation/invitations.controller.js';
import { MembersController } from './presentation/members.controller.js';
import { OrganizationsController } from './presentation/organizations.controller.js';
import { RolesController } from './presentation/roles.controller.js';

/** `api` role: organization creation, listings and member management. */
@Module({
  imports: [OrganizationCoreModule, SessionGuardModule],
  controllers: [
    OrganizationsController,
    InvitationsController,
    RolesController,
    MembersController,
  ],
})
export class OrganizationApiModule {}
