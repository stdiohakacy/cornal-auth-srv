import type { InvitationGateway, PendingInvitation } from './ports.js';

export class ListInvitationsUseCase {
  constructor(private readonly invitations: InvitationGateway) {}

  execute(input: { orgId: string }): Promise<PendingInvitation[]> {
    return this.invitations.list(input.orgId);
  }
}
