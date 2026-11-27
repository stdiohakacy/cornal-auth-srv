import { Module, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CLOCK,
  type Clock,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../shared/application/ports.js';
import { OutboxTopics } from '../../shared/infrastructure/persistence/outbox-topics.js';
import { TransactionContext } from '../../shared/infrastructure/persistence/transaction-context.js';
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
  type InvitationRepository,
  MEMBERSHIP_REPOSITORY,
  type MembershipRepository,
  ORGANIZATION_READS,
  ORGANIZATION_REPOSITORY,
  type OrganizationReads,
  type OrganizationRepository,
  ROLE_REPOSITORY,
  type RoleRepository,
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
    {
      provide: ORGANIZATION_REPOSITORY,
      inject: [DataSource, TransactionContext],
      useFactory: (ds: DataSource, tx: TransactionContext) =>
        new TypeOrmOrganizationRepository(ds, tx),
    },
    {
      provide: MEMBERSHIP_REPOSITORY,
      inject: [DataSource, TransactionContext],
      useFactory: (ds: DataSource, tx: TransactionContext) =>
        new TypeOrmMembershipRepository(ds, tx),
    },
    {
      provide: ROLE_REPOSITORY,
      inject: [DataSource, TransactionContext],
      useFactory: (ds: DataSource, tx: TransactionContext) =>
        new TypeOrmRoleRepository(ds, tx),
    },
    {
      provide: INVITATION_REPOSITORY,
      inject: [TransactionContext],
      useFactory: (tx: TransactionContext) => new InvitationEventRepository(tx),
    },
    {
      provide: ORGANIZATION_READS,
      inject: [DataSource],
      useFactory: (ds: DataSource): OrganizationReads =>
        new OrganizationQueries(ds),
    },
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
    {
      provide: CreateOrganizationUseCase,
      inject: [
        USER_DIRECTORY,
        ORGANIZATION_REPOSITORY,
        MEMBERSHIP_REPOSITORY,
        SYSTEM_ROLE_LOOKUP,
        UNIT_OF_WORK,
        CLOCK,
      ],
      useFactory: (
        users: UserDirectory,
        orgs: OrganizationRepository,
        memberships: MembershipRepository,
        roles: SystemRoleLookup,
        uow: UnitOfWork,
        clock: Clock,
      ) =>
        new CreateOrganizationUseCase(
          users,
          orgs,
          memberships,
          roles,
          uow,
          clock,
        ),
    },
    {
      provide: ListMyOrganizationsUseCase,
      inject: [ORGANIZATION_READS],
      useFactory: (reads: OrganizationReads) =>
        new ListMyOrganizationsUseCase(reads),
    },
    {
      provide: ListMembersUseCase,
      inject: [ORGANIZATION_READS, USER_DIRECTORY],
      useFactory: (reads: OrganizationReads, users: UserDirectory) =>
        new ListMembersUseCase(reads, users),
    },
    {
      provide: ResolveOrgContextUseCase,
      inject: [ORGANIZATION_READS],
      useFactory: (reads: OrganizationReads) =>
        new ResolveOrgContextUseCase(reads),
    },
    {
      provide: UpdateMemberUseCase,
      inject: [
        ORGANIZATION_READS,
        MEMBERSHIP_REPOSITORY,
        SYSTEM_ROLE_LOOKUP,
        UNIT_OF_WORK,
      ],
      useFactory: (
        reads: OrganizationReads,
        memberships: MembershipRepository,
        roles: SystemRoleLookup,
        uow: UnitOfWork,
      ) => new UpdateMemberUseCase(reads, memberships, roles, uow),
    },
    {
      provide: RemoveMemberUseCase,
      inject: [
        ORGANIZATION_READS,
        MEMBERSHIP_REPOSITORY,
        SYSTEM_ROLE_LOOKUP,
        UNIT_OF_WORK,
      ],
      useFactory: (
        reads: OrganizationReads,
        memberships: MembershipRepository,
        roles: SystemRoleLookup,
        uow: UnitOfWork,
      ) => new RemoveMemberUseCase(reads, memberships, roles, uow),
    },
    {
      provide: ListRolesUseCase,
      inject: [ORGANIZATION_READS],
      useFactory: (reads: OrganizationReads) => new ListRolesUseCase(reads),
    },
    {
      provide: CreateRoleUseCase,
      inject: [ORGANIZATION_READS, ROLE_REPOSITORY, UNIT_OF_WORK, CLOCK],
      useFactory: (
        reads: OrganizationReads,
        roles: RoleRepository,
        uow: UnitOfWork,
        clock: Clock,
      ) => new CreateRoleUseCase(reads, roles, uow, clock),
    },
    {
      provide: UpdateRoleUseCase,
      inject: [
        ORGANIZATION_READS,
        ROLE_REPOSITORY,
        ORGANIZATION_REPOSITORY,
        UNIT_OF_WORK,
      ],
      useFactory: (
        reads: OrganizationReads,
        roles: RoleRepository,
        orgs: OrganizationRepository,
        uow: UnitOfWork,
      ) => new UpdateRoleUseCase(reads, roles, orgs, uow),
    },
    {
      provide: DeleteRoleUseCase,
      inject: [ORGANIZATION_READS, ROLE_REPOSITORY, UNIT_OF_WORK],
      useFactory: (
        reads: OrganizationReads,
        roles: RoleRepository,
        uow: UnitOfWork,
      ) => new DeleteRoleUseCase(reads, roles, uow),
    },
    {
      provide: InviteMemberUseCase,
      inject: [
        ORGANIZATION_READS,
        ORGANIZATION_REPOSITORY,
        INVITATION_REPOSITORY,
        UNIT_OF_WORK,
        CLOCK,
      ],
      useFactory: (
        reads: OrganizationReads,
        orgs: OrganizationRepository,
        invitations: InvitationRepository,
        uow: UnitOfWork,
        clock: Clock,
      ) => new InviteMemberUseCase(reads, orgs, invitations, uow, clock),
    },
    {
      provide: AcceptInvitationUseCase,
      inject: [
        INVITATION_GATEWAY,
        ORGANIZATION_REPOSITORY,
        MEMBERSHIP_REPOSITORY,
        ORGANIZATION_READS,
        SYSTEM_ROLE_LOOKUP,
        UNIT_OF_WORK,
        CLOCK,
      ],
      useFactory: (
        gateway: InvitationGateway,
        orgs: OrganizationRepository,
        memberships: MembershipRepository,
        reads: OrganizationReads,
        roles: SystemRoleLookup,
        uow: UnitOfWork,
        clock: Clock,
      ) =>
        new AcceptInvitationUseCase(
          gateway,
          orgs,
          memberships,
          reads,
          roles,
          uow,
          clock,
        ),
    },
    {
      provide: ListInvitationsUseCase,
      inject: [INVITATION_GATEWAY],
      useFactory: (gateway: InvitationGateway) =>
        new ListInvitationsUseCase(gateway),
    },
    {
      provide: RevokeInvitationUseCase,
      inject: [INVITATION_GATEWAY],
      useFactory: (gateway: InvitationGateway) =>
        new RevokeInvitationUseCase(gateway),
    },
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
