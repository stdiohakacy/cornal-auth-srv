import { Inject, Injectable } from '@nestjs/common';
import { OnOutboxMessage, type OutboxHandlerContext } from '@nestjs/outbox';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '#src/shared/application/ports.js';
import { ok } from '#src/shared/domain/result.js';
import { TransactionContext } from '#src/shared/infrastructure/persistence/transaction-context.js';
import { IssueOrgInvitationUseCase } from '#src/modules/identity/application/issue-org-invitation.use-case.js';

/** Outbox message = the whole domain event; its data sits under `payload`. */
const InvitationCreatedMessage = z.object({
  payload: z.object({
    invitationId: z.string(),
    orgId: z.string(),
    orgName: z.string(),
    email: z.string(),
    roleIds: z.array(z.string()),
    invitedBy: z.string(),
  }),
});

/**
 * `worker` role: turns an invitation request into a single-use token + email (identity façade).
 * Inbox record, token row and a successful send commit together; a failed send retries.
 */
@Injectable()
export class OrganizationInvitationConsumer {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly tx: TransactionContext,
    private readonly issue: IssueOrgInvitationUseCase,
  ) {}

  @OnOutboxMessage('organization.invitation.created', {
    consumer: 'org-invitation-email',
  })
  async onInvitationCreated(
    message: unknown,
    ctx: OutboxHandlerContext<EntityManager>,
  ): Promise<void> {
    const { payload } = InvitationCreatedMessage.parse(message); // malformed → throw → retried/dead-lettered
    await this.uow.run(async () =>
      ok(
        await ctx.processInTransaction(this.tx.requireManager(), () =>
          this.issue.execute(payload),
        ),
      ),
    );
  }
}
