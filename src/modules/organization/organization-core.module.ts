import { Module, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CLOCK, UNIT_OF_WORK } from '#src/shared/application/ports.js';
import { provideClass } from '#src/shared/infrastructure/di/provide-class.js';
import { OutboxTopics } from '#src/shared/infrastructure/persistence/outbox-topics.js';
import { TransactionContext } from '#src/shared/infrastructure/persistence/transaction-context.js';
import { SystemRoles } from '../access-control/access-control-core.module.js';
import { ConsumeOrgInvitationUseCase } from '../identity/application/consume-org-invitation.use-case.js';
import { GetUserAuthStateUseCase } from '../identity/application/get-user-auth-state.use-case.js';
import { GetUserEmailsUseCase } from '../identity/application/get-user-emails.use-case.js';
import { ListOrgInvitationsUseCase } from '../identity/application/list-org-invitations.use-case.js';
import { RevokeOrgInvitationUseCase } from '../identity/application/revoke-org-invitation.use-case.js';
import type { UserId } from '../identity/domain/user.js';
import { IdentityCoreModule } from '../identity/identity-core.module.js';
import { AcceptInvitationUseCase } from './application/accept-invitation.use-case.js';
import { CreateOrganizationUseCase } from './application/create-organization.use-case.js';
import { CreateRoleUseCase } from './application/create-role.use-case.js';
import { DeleteRoleUseCase } from './application/delete-role.use-case.js';
import { InviteMemberUseCase } from './application/invite-member.use-case.js';
import { ListInvitationsUseCase } from './application/list-invitations.use-case.js';
import { ListMembersUseCase } from './application/list-members.use-case.js';
import { ListMyOrganizationsUseCase } from './application/list-my-organizations.use-case.js';
import { ListRolesUseCase } from './application/list-roles.use-case.js';
import {
  INVITATION_GATEWAY,
  INVITATION_REPOSITORY,
  type InvitationGateway,
  MEMBERSHIP_REPOSITORY,
  ORGANIZATION_READS,
  ORGANIZATION_REPOSITORY,
  ROLE_REPOSITORY,
  SYSTEM_ROLE_LOOKUP,
  type SystemRoleLookup,
  USER_DIRECTORY,
  type UserDirectory,
} from './application/ports.js';
import { RemoveMemberUseCase } from './application/remove-member.use-case.js';
import { ResolveOrgContextUseCase } from './application/resolve-org-context.use-case.js';
import { RevokeInvitationUseCase } from './application/revoke-invitation.use-case.js';
import { UpdateMemberUseCase } from './application/update-member.use-case.js';
import { UpdateRoleUseCase } from './application/update-role.use-case.js';
import { InvitationEventRepository } from './infrastructure/invitation-event.repository.js';
import { OrganizationQueries } from './infrastructure/organization-queries.js';
import { TypeOrmMembershipRepository } from './infrastructure/typeorm-membership.repository.js';
import { TypeOrmOrganizationRepository } from './infrastructure/typeorm-organization.repository.js';
import { TypeOrmRoleRepository } from './infrastructure/typeorm-role.repository.js';

/** Organizations, memberships, custom roles and invitations. Identity only through its façades. */
@Module({
  imports: [IdentityCoreModule],
  providers: [
    provideClass(
      TypeOrmOrganizationRepository,
      [DataSource, TransactionContext],
      ORGANIZATION_REPOSITORY,
    ),
    provideClass(
      TypeOrmMembershipRepository,
      [DataSource, TransactionContext],
      MEMBERSHIP_REPOSITORY,
    ),
    provideClass(
      TypeOrmRoleRepository,
      [DataSource, TransactionContext],
      ROLE_REPOSITORY,
    ),
    provideClass(
      InvitationEventRepository,
      [TransactionContext],
      INVITATION_REPOSITORY,
    ),
    provideClass(OrganizationQueries, [DataSource], ORGANIZATION_READS),
    {
      provide: USER_DIRECTORY,
      inject: [GetUserAuthStateUseCase, GetUserEmailsUseCase],
      useFactory: (
        authState: GetUserAuthStateUseCase,
        emails: GetUserEmailsUseCase,
      ): UserDirectory => ({
        isEmailVerified: async (userId) =>
          (await authState.execute({ userId: userId as UserId }))
            ?.emailVerified ?? false,
        emailsOf: (userIds) => emails.execute({ userIds }),
      }),
    },
    {
      provide: INVITATION_GATEWAY,
      inject: [
        ConsumeOrgInvitationUseCase,
        ListOrgInvitationsUseCase,
        RevokeOrgInvitationUseCase,
      ],
      useFactory: (
        consume: ConsumeOrgInvitationUseCase,
        list: ListOrgInvitationsUseCase,
        revoke: RevokeOrgInvitationUseCase,
      ): InvitationGateway => ({
        consume: (token, userId) => consume.execute({ token, userId }),
        list: (orgId) => list.execute({ orgId }),
        revoke: (orgId, invitationId) =>
          revoke.execute({ orgId, invitationId }),
      }),
    },
    {
      provide: SYSTEM_ROLE_LOOKUP,
      inject: [SystemRoles],
      useFactory: (roles: SystemRoles): SystemRoleLookup => ({
        ownerRoleId: () => roles.ids.owner,
        memberRoleId: () => roles.ids.member,
      }),
    },
    provideClass(CreateOrganizationUseCase, [
      USER_DIRECTORY,
      ORGANIZATION_REPOSITORY,
      MEMBERSHIP_REPOSITORY,
      SYSTEM_ROLE_LOOKUP,
      UNIT_OF_WORK,
      CLOCK,
    ]),
    provideClass(ListMyOrganizationsUseCase, [ORGANIZATION_READS]),
    provideClass(ListMembersUseCase, [ORGANIZATION_READS, USER_DIRECTORY]),
    provideClass(ResolveOrgContextUseCase, [ORGANIZATION_READS]),
    provideClass(UpdateMemberUseCase, [
      ORGANIZATION_READS,
      MEMBERSHIP_REPOSITORY,
      SYSTEM_ROLE_LOOKUP,
      UNIT_OF_WORK,
    ]),
    provideClass(RemoveMemberUseCase, [
      ORGANIZATION_READS,
      MEMBERSHIP_REPOSITORY,
      SYSTEM_ROLE_LOOKUP,
      UNIT_OF_WORK,
    ]),
    provideClass(ListRolesUseCase, [ORGANIZATION_READS]),
    provideClass(CreateRoleUseCase, [
      ORGANIZATION_READS,
      ROLE_REPOSITORY,
      UNIT_OF_WORK,
      CLOCK,
    ]),
    provideClass(UpdateRoleUseCase, [
      ORGANIZATION_READS,
      ROLE_REPOSITORY,
      ORGANIZATION_REPOSITORY,
      UNIT_OF_WORK,
    ]),
    provideClass(DeleteRoleUseCase, [
      ORGANIZATION_READS,
      ROLE_REPOSITORY,
      UNIT_OF_WORK,
    ]),
    provideClass(InviteMemberUseCase, [
      ORGANIZATION_READS,
      ORGANIZATION_REPOSITORY,
      INVITATION_REPOSITORY,
      UNIT_OF_WORK,
      CLOCK,
    ]),
    provideClass(AcceptInvitationUseCase, [
      INVITATION_GATEWAY,
      ORGANIZATION_REPOSITORY,
      MEMBERSHIP_REPOSITORY,
      ORGANIZATION_READS,
      SYSTEM_ROLE_LOOKUP,
      UNIT_OF_WORK,
      CLOCK,
    ]),
    provideClass(ListInvitationsUseCase, [INVITATION_GATEWAY]),
    provideClass(RevokeInvitationUseCase, [INVITATION_GATEWAY]),
  ],
  exports: [
    CreateOrganizationUseCase,
    ListMyOrganizationsUseCase,
    ListMembersUseCase,
    ResolveOrgContextUseCase,
    UpdateMemberUseCase,
    RemoveMemberUseCase,
    ListRolesUseCase,
    CreateRoleUseCase,
    UpdateRoleUseCase,
    DeleteRoleUseCase,
    InviteMemberUseCase,
    AcceptInvitationUseCase,
    ListInvitationsUseCase,
    RevokeInvitationUseCase,
  ],
})
export class OrganizationCoreModule implements OnModuleInit {
  constructor(private readonly topics: OutboxTopics) {}

  /** Topic with a consumer in OrganizationWorkerModule (see OutboxTopics). */
  onModuleInit(): void {
    this.topics.register('organization.invitation.created');
  }
}
