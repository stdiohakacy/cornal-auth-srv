import { availableParallelism } from 'node:os';
import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { APP_CONFIG, type AppConfig } from '../../config/env.schema.js';
import {
  CLOCK,
  type Clock,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../shared/application/ports.js';
import { HashAdmissionGate } from '../../shared/infrastructure/hash-admission-gate.js';
import { TransactionContext } from '../../shared/infrastructure/persistence/transaction-context.js';
import { REDIS } from '../../shared/infrastructure/redis/redis.module.js';
import { IssueEmailVerificationUseCase } from './application/issue-email-verification.use-case.js';
import {
  EMAIL_SENDER,
  type EmailSender,
  LOGIN_ATTEMPT_COUNTER,
  type LoginAttemptCounter,
  ONE_TIME_TOKEN_REPOSITORY,
  type OneTimeTokenRepository,
  PASSWORD_HASHER,
  type PasswordHasher,
  SECRET_TOKEN_GENERATOR,
  type SecretTokenGenerator,
  USER_REPOSITORY,
  type UserRepository,
} from './application/ports.js';
import { NotifyRegistrationAttemptUseCase } from './application/notify-registration-attempt.use-case.js';
import { RegisterUserUseCase } from './application/register-user.use-case.js';
import { VerifyCredentialsUseCase } from './application/verify-credentials.use-case.js';
import { VerifyEmailUseCase } from './application/verify-email.use-case.js';
import {
  Argon2PasswordHasher,
  DUMMY_PASSWORD_HASH,
} from './infrastructure/argon2-password-hasher.js';
import { GatedPasswordHasher } from './infrastructure/gated-password-hasher.js';
import { resolveHashConcurrency } from './infrastructure/hash-concurrency.js';
import { LogEmailSender } from './infrastructure/log-email-sender.js';
import { NodeSecretTokenGenerator } from './infrastructure/node-secret-token-generator.js';
import { RedisLoginAttemptCounter } from './infrastructure/redis-login-attempt-counter.js';
import { TypeOrmOneTimeTokenRepository } from './infrastructure/typeorm-one-time-token.repository.js';
import { TypeOrmUserRepository } from './infrastructure/typeorm-user.repository.js';

/**
 * Identity adapters and use cases. Use cases stay framework-free: every one is built with
 * useFactory from Symbol-token ports. Exported use cases are the module's public API.
 */
@Module({
  providers: [
    {
      provide: USER_REPOSITORY,
      inject: [DataSource, TransactionContext],
      useFactory: (ds: DataSource, tx: TransactionContext) =>
        new TypeOrmUserRepository(ds, tx),
    },
    {
      provide: ONE_TIME_TOKEN_REPOSITORY,
      inject: [DataSource, TransactionContext],
      useFactory: (ds: DataSource, tx: TransactionContext) =>
        new TypeOrmOneTimeTokenRepository(ds, tx),
    },
    {
      provide: PASSWORD_HASHER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const concurrency = resolveHashConcurrency(
          config,
          availableParallelism(),
        );
        const pepper =
          config.PASSWORD_PEPPER === undefined
            ? undefined
            : Buffer.from(config.PASSWORD_PEPPER);
        return new GatedPasswordHasher(
          new Argon2PasswordHasher(pepper),
          new HashAdmissionGate(concurrency, concurrency * 2),
        );
      },
    },
    {
      provide: LOGIN_ATTEMPT_COUNTER,
      inject: [REDIS],
      useFactory: (redis: Redis) => new RedisLoginAttemptCounter(redis),
    },
    {
      provide: SECRET_TOKEN_GENERATOR,
      useValue: new NodeSecretTokenGenerator(),
    },
    { provide: EMAIL_SENDER, useValue: new LogEmailSender() },
    {
      provide: RegisterUserUseCase,
      inject: [USER_REPOSITORY, PASSWORD_HASHER, UNIT_OF_WORK, CLOCK],
      useFactory: (
        users: UserRepository,
        hasher: PasswordHasher,
        uow: UnitOfWork,
        clock: Clock,
      ) => new RegisterUserUseCase(users, hasher, uow, clock),
    },
    {
      provide: VerifyEmailUseCase,
      inject: [
        USER_REPOSITORY,
        ONE_TIME_TOKEN_REPOSITORY,
        SECRET_TOKEN_GENERATOR,
        UNIT_OF_WORK,
        CLOCK,
      ],
      useFactory: (
        users: UserRepository,
        tokens: OneTimeTokenRepository,
        generator: SecretTokenGenerator,
        uow: UnitOfWork,
        clock: Clock,
      ) => new VerifyEmailUseCase(users, tokens, generator, uow, clock),
    },
    {
      provide: IssueEmailVerificationUseCase,
      inject: [
        USER_REPOSITORY,
        ONE_TIME_TOKEN_REPOSITORY,
        SECRET_TOKEN_GENERATOR,
        EMAIL_SENDER,
        UNIT_OF_WORK,
        CLOCK,
        APP_CONFIG,
      ],
      useFactory: (
        users: UserRepository,
        tokens: OneTimeTokenRepository,
        generator: SecretTokenGenerator,
        emails: EmailSender,
        uow: UnitOfWork,
        clock: Clock,
        config: AppConfig,
      ) =>
        new IssueEmailVerificationUseCase(
          users,
          tokens,
          generator,
          emails,
          uow,
          clock,
          config.EMAIL_VERIFICATION_URL,
        ),
    },
    {
      provide: NotifyRegistrationAttemptUseCase,
      inject: [USER_REPOSITORY, EMAIL_SENDER, APP_CONFIG],
      useFactory: (
        users: UserRepository,
        emails: EmailSender,
        config: AppConfig,
      ) =>
        new NotifyRegistrationAttemptUseCase(
          users,
          emails,
          config.APP_LOGIN_URL,
        ),
    },
    {
      provide: VerifyCredentialsUseCase,
      inject: [
        USER_REPOSITORY,
        PASSWORD_HASHER,
        LOGIN_ATTEMPT_COUNTER,
        UNIT_OF_WORK,
        CLOCK,
      ],
      useFactory: (
        users: UserRepository,
        hasher: PasswordHasher,
        attempts: LoginAttemptCounter,
        uow: UnitOfWork,
        clock: Clock,
      ) =>
        new VerifyCredentialsUseCase(
          users,
          hasher,
          attempts,
          uow,
          clock,
          DUMMY_PASSWORD_HASH,
        ),
    },
  ],
  exports: [
    NotifyRegistrationAttemptUseCase,
    RegisterUserUseCase,
    VerifyEmailUseCase,
    IssueEmailVerificationUseCase,
    VerifyCredentialsUseCase,
  ],
})
export class IdentityCoreModule {}
