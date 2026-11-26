import { Inject, Injectable } from '@nestjs/common';
import { OnOutboxMessage, type OutboxHandlerContext } from '@nestjs/outbox';
import type { EntityManager } from 'typeorm';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../../shared/application/ports.js';
import { ok } from '../../../shared/domain/result.js';
import { TransactionContext } from '../../../shared/infrastructure/persistence/transaction-context.js';
import { IssueEmailVerificationUseCase } from '../application/issue-email-verification.use-case.js';
import { NotifyRegistrationAttemptUseCase } from '../application/notify-registration-attempt.use-case.js';
import type { UserId } from '../domain/user.js';

type UserEventPayload = { readonly aggregateId: string };

const isUserEvent = (payload: unknown): payload is UserEventPayload =>
  typeof payload === 'object' &&
  payload !== null &&
  'aggregateId' in payload &&
  typeof payload.aggregateId === 'string';

/**
 * `worker` role: identity emails. The inbox record and a successful send commit together (with the
 * token row for verification): a failed send rolls back and the outbox retries; a redelivered
 * message is a duplicate no-op.
 */
@Injectable()
export class IdentityEmailConsumer {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly tx: TransactionContext,
    private readonly issueVerification: IssueEmailVerificationUseCase,
    private readonly notifyAttempt: NotifyRegistrationAttemptUseCase,
  ) {}

  @OnOutboxMessage('identity.user.registered', {
    consumer: 'email-verification',
  })
  async onRegistered(
    payload: unknown,
    ctx: OutboxHandlerContext<EntityManager>,
  ): Promise<void> {
    if (!isUserEvent(payload))
      throw new Error('Malformed identity.user.registered payload');
    const userId = payload.aggregateId as UserId; // ids in events come from our own aggregates
    await this.uow.run(async () =>
      ok(
        await ctx.processInTransaction(this.tx.requireManager(), () =>
          this.issueVerification.execute({ userId }),
        ),
      ),
    );
  }

  @OnOutboxMessage('identity.user.registration_attempted', {
    consumer: 'account-exists-notice',
  })
  async onRegistrationAttempted(
    payload: unknown,
    ctx: OutboxHandlerContext<EntityManager>,
  ): Promise<void> {
    if (!isUserEvent(payload))
      throw new Error('Malformed identity.user.registration_attempted payload');
    const userId = payload.aggregateId as UserId;
    await this.uow.run(async () =>
      ok(
        await ctx.processInTransaction(this.tx.requireManager(), () =>
          this.notifyAttempt.execute({ userId }),
        ),
      ),
    );
  }
}
