import { Inject, Injectable } from '@nestjs/common';
import { OnOutboxMessage, type OutboxHandlerContext } from '@nestjs/outbox';
import type { EntityManager } from 'typeorm';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '#src/shared/application/ports.js';
import { ok } from '#src/shared/domain/result.js';
import { TransactionContext } from '#src/shared/infrastructure/persistence/transaction-context.js';
import { RevokeAllSessionsUseCase } from '../application/revoke-all-sessions.use-case.js';

const userIdOf = (payload: unknown): string => {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'aggregateId' in payload
  ) {
    const { aggregateId } = payload;
    if (typeof aggregateId === 'string') return aggregateId;
  }
  throw new Error('Malformed identity.user.password_changed payload');
};

/**
 * `worker` role. A changed password (reset or signed-in change) signs out every device: the
 * revocations and the inbox record commit together.
 */
@Injectable()
export class SessionRevocationConsumer {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly tx: TransactionContext,
    private readonly revokeAll: RevokeAllSessionsUseCase,
  ) {}

  @OnOutboxMessage('identity.user.password_changed', {
    consumer: 'session-revoke-on-password-change',
  })
  async onPasswordChanged(
    payload: unknown,
    ctx: OutboxHandlerContext<EntityManager>,
  ): Promise<void> {
    const userId = userIdOf(payload);
    await this.uow.run(async () =>
      ok(
        await ctx.processInTransaction(this.tx.requireManager(), () =>
          this.revokeAll.execute({ userId, reason: 'password_changed' }),
        ),
      ),
    );
  }
}
