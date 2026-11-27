import type { TransactionContext } from '#src/shared/infrastructure/persistence/transaction-context.js';
import type { InvitationRepository } from '../application/ports.js';
import type { Invitation } from '../domain/invitation.js';

/** Invitations have no table here: saving only hands the event to the outbox of this transaction. */
export class InvitationEventRepository implements InvitationRepository {
  constructor(private readonly tx: TransactionContext) {}

  async save(invitation: Invitation): Promise<void> {
    this.tx.requireManager();
    invitation.markPersisted();
    this.tx.track(invitation);
  }
}
