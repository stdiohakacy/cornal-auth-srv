import { availableParallelism } from 'node:os';
import { Module, type OnModuleInit } from '@nestjs/common';
import { Mailer } from '@nestjs/mail';
import { DataSource } from 'typeorm';
import { APP_CONFIG, type AppConfig } from '#src/config/env.schema.js';
import { CLOCK, UNIT_OF_WORK } from '#src/shared/application/ports.js';
import {
  fixed,
  from,
  provideClass,
} from '#src/shared/infrastructure/di/provide-class.js';
import { HashAdmissionGate } from '#src/shared/infrastructure/hash-admission-gate.js';
import { OutboxTopics } from '#src/shared/infrastructure/persistence/outbox-topics.js';
import { TransactionContext } from '#src/shared/infrastructure/persistence/transaction-context.js';
import { REDIS } from '#src/shared/infrastructure/redis/redis.module.js';
import { IssueEmailVerificationUseCase } from './application/issue-email-verification.use-case.js';
import {
  BREACHED_PASSWORD_CHECKER,
  EMAIL_SENDER,
  LOGIN_ATTEMPT_COUNTER,
  ONE_TIME_TOKEN_REPOSITORY,
  PASSWORD_HASHER,
  SECRET_TOKEN_GENERATOR,
  USER_REPOSITORY,
} from './application/ports.js';
import { NotifyRegistrationAttemptUseCase } from './application/notify-registration-attempt.use-case.js';
import { ChangePasswordUseCase } from './application/change-password.use-case.js';
import { GetUserAuthStateUseCase } from './application/get-user-auth-state.use-case.js';
import { GetUserEmailsUseCase } from './application/get-user-emails.use-case.js';
import { ConsumeOrgInvitationUseCase } from './application/consume-org-invitation.use-case.js';
import { IssueOrgInvitationUseCase } from './application/issue-org-invitation.use-case.js';
import { ListOrgInvitationsUseCase } from './application/list-org-invitations.use-case.js';
import { RevokeOrgInvitationUseCase } from './application/revoke-org-invitation.use-case.js';
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
    provideClass(
      TypeOrmUserRepository,
      [DataSource, TransactionContext],
      USER_REPOSITORY,
    ),
    provideClass(
      TypeOrmOneTimeTokenRepository,
      [DataSource, TransactionContext],
      ONE_TIME_TOKEN_REPOSITORY,
    ),
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
    provideClass(RedisLoginAttemptCounter, [REDIS], LOGIN_ATTEMPT_COUNTER),
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
    provideClass(MailerEmailSender, [Mailer], EMAIL_SENDER),
    provideClass(RegisterUserUseCase, [
      USER_REPOSITORY,
      PASSWORD_HASHER,
      BREACHED_PASSWORD_CHECKER,
      UNIT_OF_WORK,
      CLOCK,
    ]),
    provideClass(VerifyEmailUseCase, [
      USER_REPOSITORY,
      ONE_TIME_TOKEN_REPOSITORY,
      SECRET_TOKEN_GENERATOR,
      UNIT_OF_WORK,
      CLOCK,
    ]),
    provideClass(IssueEmailVerificationUseCase, [
      USER_REPOSITORY,
      ONE_TIME_TOKEN_REPOSITORY,
      SECRET_TOKEN_GENERATOR,
      EMAIL_SENDER,
      UNIT_OF_WORK,
      CLOCK,
      from<AppConfig>(APP_CONFIG, (c) => c.EMAIL_VERIFICATION_URL),
    ]),
    provideClass(NotifyRegistrationAttemptUseCase, [
      USER_REPOSITORY,
      EMAIL_SENDER,
      from<AppConfig>(APP_CONFIG, (c) => c.APP_LOGIN_URL),
    ]),
    provideClass(VerifyCredentialsUseCase, [
      USER_REPOSITORY,
      PASSWORD_HASHER,
      LOGIN_ATTEMPT_COUNTER,
      UNIT_OF_WORK,
      CLOCK,
      fixed(DUMMY_PASSWORD_HASH),
    ]),
    provideClass(GetUserAuthStateUseCase, [USER_REPOSITORY, CLOCK]),
    provideClass(GetUserEmailsUseCase, [USER_REPOSITORY]),
    provideClass(IssueOrgInvitationUseCase, [
      ONE_TIME_TOKEN_REPOSITORY,
      SECRET_TOKEN_GENERATOR,
      EMAIL_SENDER,
      UNIT_OF_WORK,
      CLOCK,
      from<AppConfig>(APP_CONFIG, (c) => c.ORG_INVITATION_URL),
    ]),
    provideClass(ConsumeOrgInvitationUseCase, [
      USER_REPOSITORY,
      ONE_TIME_TOKEN_REPOSITORY,
      SECRET_TOKEN_GENERATOR,
      UNIT_OF_WORK,
      CLOCK,
    ]),
    provideClass(ListOrgInvitationsUseCase, [ONE_TIME_TOKEN_REPOSITORY, CLOCK]),
    provideClass(RevokeOrgInvitationUseCase, [
      ONE_TIME_TOKEN_REPOSITORY,
      UNIT_OF_WORK,
    ]),
    provideClass(ChangePasswordUseCase, [
      USER_REPOSITORY,
      PASSWORD_HASHER,
      BREACHED_PASSWORD_CHECKER,
      LOGIN_ATTEMPT_COUNTER,
      UNIT_OF_WORK,
      CLOCK,
    ]),
    provideClass(RequestPasswordResetUseCase, [
      USER_REPOSITORY,
      UNIT_OF_WORK,
      CLOCK,
    ]),
    provideClass(IssuePasswordResetUseCase, [
      USER_REPOSITORY,
      ONE_TIME_TOKEN_REPOSITORY,
      SECRET_TOKEN_GENERATOR,
      EMAIL_SENDER,
      UNIT_OF_WORK,
      CLOCK,
      from<AppConfig>(APP_CONFIG, (c) => c.PASSWORD_RESET_URL),
    ]),
    provideClass(ResetPasswordUseCase, [
      USER_REPOSITORY,
      ONE_TIME_TOKEN_REPOSITORY,
      SECRET_TOKEN_GENERATOR,
      PASSWORD_HASHER,
      BREACHED_PASSWORD_CHECKER,
      UNIT_OF_WORK,
      CLOCK,
    ]),
    provideClass(NotifyPasswordChangedUseCase, [
      USER_REPOSITORY,
      EMAIL_SENDER,
      from<AppConfig>(APP_CONFIG, (c) => c.APP_LOGIN_URL),
    ]),
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
    GetUserEmailsUseCase,
    IssueOrgInvitationUseCase,
    ConsumeOrgInvitationUseCase,
    ListOrgInvitationsUseCase,
    RevokeOrgInvitationUseCase,
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
