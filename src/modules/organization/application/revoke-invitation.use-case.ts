import { err, ok, type Result } from '#src/shared/domain/result.js';
import { InvitationNotFoundError } from '../domain/organization.errors.js';
import type { InvitationGateway } from './ports.js';

export class RevokeInvitationUseCase {
  constructor(private readonly invitations: InvitationGateway) {}

  async execute(input: {
    orgId: string;
    invitationId: string;
  }): Promise<Result<void, InvitationNotFoundError>> {
    return (await this.invitations.revoke(input.orgId, input.invitationId))
      ? ok(undefined)
      : err(new InvitationNotFoundError());
  }
}
