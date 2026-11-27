import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { APP_CONFIG, type AppConfig } from '#src/config/env.schema.js';
import { CLOCK, UNIT_OF_WORK } from '#src/shared/application/ports.js';
import type { DomainError } from '#src/shared/domain/domain-error.js';
import {
  from,
  provideClass,
} from '#src/shared/infrastructure/di/provide-class.js';
import { TransactionContext } from '#src/shared/infrastructure/persistence/transaction-context.js';
import { GetUserAuthStateUseCase } from '../identity/application/get-user-auth-state.use-case.js';
import { VerifyCredentialsUseCase } from '../identity/application/verify-credentials.use-case.js';
import { IdentityCoreModule } from '../identity/identity-core.module.js';
import { ResolveOrgContextUseCase } from '../organization/application/resolve-org-context.use-case.js';
import { OrganizationCoreModule } from '../organization/organization-core.module.js';
import type { SessionTtl } from './application/issued-tokens.js';
import { LoginUseCase } from './application/login.use-case.js';
import { ListSessionsUseCase } from './application/list-sessions.use-case.js';
import { LogoutUseCase } from './application/logout.use-case.js';
import {
  ACCESS_TOKEN_SERVICE,
  CREDENTIALS_VERIFIER,
  ORG_CONTEXT_READER,
  type OrgContextReader,
  type CredentialsVerifier,
  REFRESH_TOKEN_FACTORY,
  SESSION_REPOSITORY,
  USER_AUTH_STATE,
  type UserAuthStateReader,
} from './application/ports.js';
import { RefreshSessionUseCase } from './application/refresh-session.use-case.js';
import { RevokeAllSessionsUseCase } from './application/revoke-all-sessions.use-case.js';
import { RevokeSessionUseCase } from './application/revoke-session.use-case.js';
import { SwitchOrganizationUseCase } from './application/switch-organization.use-case.js';
import { JoseTokenService } from './infrastructure/jose-token-service.js';
import {
  KEY_RING,
  keyRingProvider,
} from './infrastructure/key-ring.provider.js';
import { NodeRefreshTokenFactory } from './infrastructure/node-refresh-token-factory.js';
import { TypeOrmSessionRepository } from './infrastructure/typeorm-session.repository.js';

const SESSION_TTL = Symbol('SESSION_TTL');

/**
 * Session adapters and use cases. Identity is reached only through its exported façades
 * (VerifyCredentialsUseCase, GetUserAuthStateUseCase), adapted here to session's own ports.
 */
@Module({
  imports: [IdentityCoreModule, OrganizationCoreModule],
  providers: [
    keyRingProvider,
    provideClass(
      JoseTokenService,
      [
        KEY_RING,
        from<AppConfig>(APP_CONFIG, (c) => c.JWT_ISSUER),
        from<AppConfig>(APP_CONFIG, (c) => c.JWT_AUDIENCE),
        from<AppConfig>(APP_CONFIG, (c) => c.ACCESS_TOKEN_TTL_SECONDS),
      ],
      ACCESS_TOKEN_SERVICE,
    ),
    { provide: REFRESH_TOKEN_FACTORY, useValue: new NodeRefreshTokenFactory() },
    provideClass(
      TypeOrmSessionRepository,
      [DataSource, TransactionContext],
      SESSION_REPOSITORY,
    ),
    {
      provide: SESSION_TTL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): SessionTtl => ({
        idleSeconds: config.REFRESH_IDLE_TTL_SECONDS,
        absoluteSeconds: config.REFRESH_ABSOLUTE_TTL_SECONDS,
      }),
    },
    {
      provide: CREDENTIALS_VERIFIER,
      inject: [VerifyCredentialsUseCase],
      useFactory: (
        useCase: VerifyCredentialsUseCase,
      ): CredentialsVerifier<DomainError> => ({
        verify: (input) => useCase.execute(input),
      }),
    },
    {
      provide: USER_AUTH_STATE,
      inject: [GetUserAuthStateUseCase],
      useFactory: (useCase: GetUserAuthStateUseCase): UserAuthStateReader => ({
        get: (userId) =>
          useCase.execute({
            userId: userId as Parameters<typeof useCase.execute>[0]['userId'],
          }),
      }),
    },
    {
      provide: ORG_CONTEXT_READER,
      inject: [ResolveOrgContextUseCase],
      useFactory: (resolve: ResolveOrgContextUseCase): OrgContextReader => ({
        contextFor: (userId, orgId) => resolve.contextFor(userId, orgId),
        defaultFor: (userId, preferredOrgId) =>
          resolve.defaultFor(userId, preferredOrgId),
      }),
    },
    provideClass(SwitchOrganizationUseCase, [
      SESSION_REPOSITORY,
      ORG_CONTEXT_READER,
      ACCESS_TOKEN_SERVICE,
      UNIT_OF_WORK,
      CLOCK,
    ]),
    provideClass(LoginUseCase, [
      CREDENTIALS_VERIFIER,
      SESSION_REPOSITORY,
      REFRESH_TOKEN_FACTORY,
      ACCESS_TOKEN_SERVICE,
      ORG_CONTEXT_READER,
      UNIT_OF_WORK,
      CLOCK,
      SESSION_TTL,
    ]),
    provideClass(RefreshSessionUseCase, [
      USER_AUTH_STATE,
      SESSION_REPOSITORY,
      REFRESH_TOKEN_FACTORY,
      ACCESS_TOKEN_SERVICE,
      ORG_CONTEXT_READER,
      UNIT_OF_WORK,
      CLOCK,
      SESSION_TTL,
    ]),
    provideClass(LogoutUseCase, [
      SESSION_REPOSITORY,
      REFRESH_TOKEN_FACTORY,
      UNIT_OF_WORK,
      CLOCK,
    ]),
    provideClass(ListSessionsUseCase, [SESSION_REPOSITORY, CLOCK]),
    provideClass(RevokeSessionUseCase, [
      SESSION_REPOSITORY,
      UNIT_OF_WORK,
      CLOCK,
    ]),
    provideClass(RevokeAllSessionsUseCase, [
      SESSION_REPOSITORY,
      UNIT_OF_WORK,
      CLOCK,
    ]),
  ],
  exports: [
    SwitchOrganizationUseCase,
    LoginUseCase,
    RefreshSessionUseCase,
    LogoutUseCase,
    ListSessionsUseCase,
    RevokeSessionUseCase,
    RevokeAllSessionsUseCase,
    ACCESS_TOKEN_SERVICE,
    KEY_RING,
  ],
})
export class SessionCoreModule {}
