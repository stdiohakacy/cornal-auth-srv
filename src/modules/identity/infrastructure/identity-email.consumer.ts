import { Inject, Injectable } from '@nestjs/common';
import { OnOutboxMessage, type OutboxHandlerContext } from '@nestjs/outbox';
import type { EntityManager } from 'typeorm';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '#src/shared/application/ports.js';
import { ok } from '#src/shared/domain/result.js';
import { TransactionContext } from '#src/shared/infrastructure/persistence/transaction-context.js';
import { IssueEmailVerificationUseCase } from '../application/issue-email-verification.use-case.js';
import { IssuePasswordResetUseCase } from '../application/issue-password-reset.use-case.js';
import { NotifyPasswordChangedUseCase } from '../application/notify-password-changed.use-case.js';
import { NotifyRegistrationAttemptUseCase } from '../application/notify-registration-attempt.use-case.js';
import type { UserId } from '../domain/user.js';

type Context = OutboxHandlerContext<EntityManager>;

/** Every identity event carries the User id as `aggregateId` (ids come from our own aggregates). */
function userIdOf(payload: unknown, topic: string): UserId {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'aggregateId' in payload &&
    typeof payload.aggregateId === 'string'
  ) {
    return payload.aggregateId as UserId;
  }
  throw new Error(`Malformed ${topic} payload`);
}

/**
 * `worker` role: identity emails. The inbox record, any token row and a successful send commit
 * together: a failed send rolls back and the outbox retries; a redelivered message is a no-op.
 */
@Injectable()
export class IdentityEmailConsumer {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly tx: TransactionContext,
    private readonly issueVerification: IssueEmailVerificationUseCase,
    private readonly notifyAttempt: NotifyRegistrationAttemptUseCase,
    private readonly issueReset: IssuePasswordResetUseCase,
    private readonly notifyPasswordChanged: NotifyPasswordChangedUseCase,
  ) {}

  @OnOutboxMessage('identity.user.registered', {
    consumer: 'email-verification',
  })
  async onRegistered(payload: unknown, ctx: Context): Promise<void> {
    const userId = userIdOf(payload, 'identity.user.registered');
    await this.exactlyOnce(ctx, () =>
      this.issueVerification.execute({ userId }),
    );
  }

  @OnOutboxMessage('identity.user.registration_attempted', {
    consumer: 'account-exists-notice',
  })
  async onRegistrationAttempted(payload: unknown, ctx: Context): Promise<void> {
    const userId = userIdOf(payload, 'identity.user.registration_attempted');
    await this.exactlyOnce(ctx, () => this.notifyAttempt.execute({ userId }));
  }

  @OnOutboxMessage('identity.user.password_reset_requested', {
    consumer: 'password-reset-link',
  })
  async onPasswordResetRequested(
    payload: unknown,
    ctx: Context,
  ): Promise<void> {
    const userId = userIdOf(payload, 'identity.user.password_reset_requested');
    await this.exactlyOnce(ctx, () => this.issueReset.execute({ userId }));
  }

  @OnOutboxMessage('identity.user.password_changed', {
    consumer: 'password-changed-notice',
  })
  async onPasswordChanged(payload: unknown, ctx: Context): Promise<void> {
    const userId = userIdOf(payload, 'identity.user.password_changed');
    await this.exactlyOnce(ctx, () =>
      this.notifyPasswordChanged.execute({ userId }),
    );
  }

  /** Runs `work` in one transaction together with the consumer's inbox record. */
  private async exactlyOnce(
    ctx: Context,
    work: () => Promise<unknown>,
  ): Promise<void> {
    await this.uow.run(async () =>
      ok(await ctx.processInTransaction(this.tx.requireManager(), work)),
    );
  }
}
