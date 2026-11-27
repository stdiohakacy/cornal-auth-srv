import { availableParallelism } from 'node:os';
import { Module, type OnModuleInit } from '@nestjs/common';
import { Mailer } from '@nestjs/mail';
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
import { OutboxTopics } from '../../shared/infrastructure/persistence/outbox-topics.js';
import { TransactionContext } from '../../shared/infrastructure/persistence/transaction-context.js';
import { REDIS } from '../../shared/infrastructure/redis/redis.module.js';
import { IssueEmailVerificationUseCase } from './application/issue-email-verification.use-case.js';
import {
  BREACHED_PASSWORD_CHECKER,
  type BreachedPasswordChecker,
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
import { ChangePasswordUseCase } from './application/change-password.use-case.js';
import { GetUserAuthStateUseCase } from './application/get-user-auth-state.use-case.js';
import { IssuePasswordResetUseCase } from './application/issue-password-reset.use-case.js';
import { NotifyPasswordChangedUseCase } from './application/notify-password-changed.use-case.js';
import { RegisterUserUseCase } from './application/register-user.use-case.js';
import { RequestPasswordResetUseCase } from './application/request-password-reset.use-case.js';
import { ResetPasswordUseCase } from './application/reset-password.use-case.js';
import { VerifyCredentialsUseCase } from './application/verify-credentials.use-case.js';
import { VerifyEmailUseCase } from './application/verify-email.use-case.js';
import {
  Argon2PasswordHasher,
  DUMMY_PASSWORD_HASH,
} from './infrastructure/argon2-password-hasher.js';
import { GatedPasswordHasher } from './infrastructure/gated-password-hasher.js';
import { resolveHashConcurrency } from './infrastructure/hash-concurrency.js';
import {
  HibpBreachedPasswordChecker,
  NeverBreachedChecker,
} from './infrastructure/hibp-breached-password-checker.js';
import { MailerEmailSender } from './infrastructure/mailer-email-sender.js';
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
      provide: BREACHED_PASSWORD_CHECKER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.PASSWORD_BREACH_CHECK
          ? new HibpBreachedPasswordChecker()
          : new NeverBreachedChecker(),
    },
    {
      provide: SECRET_TOKEN_GENERATOR,
      useValue: new NodeSecretTokenGenerator(),
    },
    {
      provide: EMAIL_SENDER,
      inject: [Mailer],
      useFactory: (mailer: Mailer) => new MailerEmailSender(mailer),
    },
    {
      provide: RegisterUserUseCase,
      inject: [
        USER_REPOSITORY,
        PASSWORD_HASHER,
        BREACHED_PASSWORD_CHECKER,
        UNIT_OF_WORK,
        CLOCK,
      ],
      useFactory: (
        users: UserRepository,
        hasher: PasswordHasher,
        breaches: BreachedPasswordChecker,
        uow: UnitOfWork,
        clock: Clock,
      ) => new RegisterUserUseCase(users, hasher, breaches, uow, clock),
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
    {
      provide: GetUserAuthStateUseCase,
      inject: [USER_REPOSITORY, CLOCK],
      useFactory: (users: UserRepository, clock: Clock) =>
        new GetUserAuthStateUseCase(users, clock),
    },
    {
      provide: ChangePasswordUseCase,
      inject: [
        USER_REPOSITORY,
        PASSWORD_HASHER,
        BREACHED_PASSWORD_CHECKER,
        LOGIN_ATTEMPT_COUNTER,
        UNIT_OF_WORK,
        CLOCK,
      ],
      useFactory: (
        users: UserRepository,
        hasher: PasswordHasher,
        breaches: BreachedPasswordChecker,
        attempts: LoginAttemptCounter,
        uow: UnitOfWork,
        clock: Clock,
      ) =>
        new ChangePasswordUseCase(
          users,
          hasher,
          breaches,
          attempts,
          uow,
          clock,
        ),
    },
    {
      provide: RequestPasswordResetUseCase,
      inject: [USER_REPOSITORY, UNIT_OF_WORK, CLOCK],
      useFactory: (users: UserRepository, uow: UnitOfWork, clock: Clock) =>
        new RequestPasswordResetUseCase(users, uow, clock),
    },
    {
      provide: IssuePasswordResetUseCase,
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
        new IssuePasswordResetUseCase(
          users,
          tokens,
          generator,
          emails,
          uow,
          clock,
          config.PASSWORD_RESET_URL,
        ),
    },
    {
      provide: ResetPasswordUseCase,
      inject: [
        USER_REPOSITORY,
        ONE_TIME_TOKEN_REPOSITORY,
        SECRET_TOKEN_GENERATOR,
        PASSWORD_HASHER,
        BREACHED_PASSWORD_CHECKER,
        UNIT_OF_WORK,
        CLOCK,
      ],
      useFactory: (
        users: UserRepository,
        tokens: OneTimeTokenRepository,
        generator: SecretTokenGenerator,
        hasher: PasswordHasher,
        breaches: BreachedPasswordChecker,
        uow: UnitOfWork,
        clock: Clock,
      ) =>
        new ResetPasswordUseCase(
          users,
          tokens,
          generator,
          hasher,
          breaches,
          uow,
          clock,
        ),
    },
    {
      provide: NotifyPasswordChangedUseCase,
      inject: [USER_REPOSITORY, EMAIL_SENDER, APP_CONFIG],
      useFactory: (
        users: UserRepository,
        emails: EmailSender,
        config: AppConfig,
      ) =>
        new NotifyPasswordChangedUseCase(users, emails, config.APP_LOGIN_URL),
    },
  ],
  exports: [
    NotifyRegistrationAttemptUseCase,
    RegisterUserUseCase,
    VerifyEmailUseCase,
    IssueEmailVerificationUseCase,
    VerifyCredentialsUseCase,
    RequestPasswordResetUseCase,
    IssuePasswordResetUseCase,
    ResetPasswordUseCase,
    NotifyPasswordChangedUseCase,
    GetUserAuthStateUseCase,
    ChangePasswordUseCase,
  ],
})
export class IdentityCoreModule implements OnModuleInit {
  constructor(private readonly topics: OutboxTopics) {}

  /** Topics with a consumer in IdentityWorkerModule (see OutboxTopics for why this list exists). */
  onModuleInit(): void {
    this.topics.register(
      'identity.user.registered',
      'identity.user.registration_attempted',
      'identity.user.password_reset_requested',
      'identity.user.password_changed',
    );
  }
}
