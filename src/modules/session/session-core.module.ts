import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema.js';
import {
  CLOCK,
  type Clock,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../shared/application/ports.js';
import type { DomainError } from '../../shared/domain/domain-error.js';
import { TransactionContext } from '../../shared/infrastructure/persistence/transaction-context.js';
import { GetUserAuthStateUseCase } from '../identity/application/get-user-auth-state.use-case.js';
import { VerifyCredentialsUseCase } from '../identity/application/verify-credentials.use-case.js';
import { IdentityCoreModule } from '../identity/identity-core.module.js';
import type { SessionTtl } from './application/issued-tokens.js';
import { LoginUseCase } from './application/login.use-case.js';
import { LogoutUseCase } from './application/logout.use-case.js';
import {
  ACCESS_TOKEN_SERVICE,
  type AccessTokenService,
  CREDENTIALS_VERIFIER,
  type CredentialsVerifier,
  REFRESH_TOKEN_FACTORY,
  type RefreshTokenFactory,
  SESSION_REPOSITORY,
  type SessionRepository,
  USER_AUTH_STATE,
  type UserAuthStateReader,
} from './application/ports.js';
import { RefreshSessionUseCase } from './application/refresh-session.use-case.js';
import { JoseTokenService } from './infrastructure/jose-token-service.js';
import {
  KEY_RING,
  keyRingProvider,
} from './infrastructure/key-ring.provider.js';
import type { KeyRing } from './infrastructure/key-ring.js';
import { NodeRefreshTokenFactory } from './infrastructure/node-refresh-token-factory.js';
import { TypeOrmSessionRepository } from './infrastructure/typeorm-session.repository.js';

const SESSION_TTL = Symbol('SESSION_TTL');

/**
 * Session adapters and use cases. Identity is reached only through its exported façades
 * (VerifyCredentialsUseCase, GetUserAuthStateUseCase), adapted here to session's own ports.
 */
@Module({
  imports: [IdentityCoreModule],
  providers: [
    keyRingProvider,
    {
      provide: ACCESS_TOKEN_SERVICE,
      inject: [KEY_RING, APP_CONFIG],
      useFactory: (keys: KeyRing, config: AppConfig) =>
        new JoseTokenService(
          keys,
          config.JWT_ISSUER,
          config.JWT_AUDIENCE,
          config.ACCESS_TOKEN_TTL_SECONDS,
        ),
    },
    { provide: REFRESH_TOKEN_FACTORY, useValue: new NodeRefreshTokenFactory() },
    {
      provide: SESSION_REPOSITORY,
      inject: [DataSource, TransactionContext],
      useFactory: (ds: DataSource, tx: TransactionContext) =>
        new TypeOrmSessionRepository(ds, tx),
    },
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
      provide: LoginUseCase,
      inject: [
        CREDENTIALS_VERIFIER,
        SESSION_REPOSITORY,
        REFRESH_TOKEN_FACTORY,
        ACCESS_TOKEN_SERVICE,
        UNIT_OF_WORK,
        CLOCK,
        SESSION_TTL,
      ],
      useFactory: (
        credentials: CredentialsVerifier<DomainError>,
        sessions: SessionRepository,
        refreshTokens: RefreshTokenFactory,
        accessTokens: AccessTokenService,
        uow: UnitOfWork,
        clock: Clock,
        ttl: SessionTtl,
      ) =>
        new LoginUseCase(
          credentials,
          sessions,
          refreshTokens,
          accessTokens,
          uow,
          clock,
          ttl,
        ),
    },
    {
      provide: RefreshSessionUseCase,
      inject: [
        USER_AUTH_STATE,
        SESSION_REPOSITORY,
        REFRESH_TOKEN_FACTORY,
        ACCESS_TOKEN_SERVICE,
        UNIT_OF_WORK,
        CLOCK,
        SESSION_TTL,
      ],
      useFactory: (
        authState: UserAuthStateReader,
        sessions: SessionRepository,
        refreshTokens: RefreshTokenFactory,
        accessTokens: AccessTokenService,
        uow: UnitOfWork,
        clock: Clock,
        ttl: SessionTtl,
      ) =>
        new RefreshSessionUseCase(
          authState,
          sessions,
          refreshTokens,
          accessTokens,
          uow,
          clock,
          ttl,
        ),
    },
    {
      provide: LogoutUseCase,
      inject: [SESSION_REPOSITORY, REFRESH_TOKEN_FACTORY, UNIT_OF_WORK, CLOCK],
      useFactory: (
        sessions: SessionRepository,
        refreshTokens: RefreshTokenFactory,
        uow: UnitOfWork,
        clock: Clock,
      ) => new LogoutUseCase(sessions, refreshTokens, uow, clock),
    },
  ],
  exports: [
    LoginUseCase,
    RefreshSessionUseCase,
    LogoutUseCase,
    ACCESS_TOKEN_SERVICE,
    KEY_RING,
  ],
})
export class SessionCoreModule {}
