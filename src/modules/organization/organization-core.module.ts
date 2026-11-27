import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CLOCK,
  type Clock,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../shared/application/ports.js';
import { TransactionContext } from '../../shared/infrastructure/persistence/transaction-context.js';
import { SystemRoles } from '../access-control/access-control-core.module.js';
import { GetUserAuthStateUseCase } from '../identity/application/get-user-auth-state.use-case.js';
import { GetUserEmailsUseCase } from '../identity/application/get-user-emails.use-case.js';
import type { UserId } from '../identity/domain/user.js';
import { IdentityCoreModule } from '../identity/identity-core.module.js';
import { CreateOrganizationUseCase } from './application/create-organization.use-case.js';
import { ListMembersUseCase } from './application/list-members.use-case.js';
import { ListMyOrganizationsUseCase } from './application/list-my-organizations.use-case.js';
import {
  MEMBERSHIP_REPOSITORY,
  type MembershipRepository,
  ORGANIZATION_READS,
  ORGANIZATION_REPOSITORY,
  type OrganizationReads,
  type OrganizationRepository,
  SYSTEM_ROLE_LOOKUP,
  type SystemRoleLookup,
  USER_DIRECTORY,
  type UserDirectory,
} from './application/ports.js';
import { ResolveOrgContextUseCase } from './application/resolve-org-context.use-case.js';
import { OrganizationQueries } from './infrastructure/organization-queries.js';
import { TypeOrmMembershipRepository } from './infrastructure/typeorm-membership.repository.js';
import { TypeOrmOrganizationRepository } from './infrastructure/typeorm-organization.repository.js';

/** Organizations and memberships. Identity is reached only through its exported façades. */
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
      provide: SYSTEM_ROLE_LOOKUP,
      inject: [SystemRoles],
      useFactory: (roles: SystemRoles): SystemRoleLookup => ({
        ownerRoleId: () => roles.ids.owner,
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
  ],
  exports: [
    CreateOrganizationUseCase,
    ListMyOrganizationsUseCase,
    ListMembersUseCase,
    ResolveOrgContextUseCase,
  ],
})
export class OrganizationCoreModule {}
