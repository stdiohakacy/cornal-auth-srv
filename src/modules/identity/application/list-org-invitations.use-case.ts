import type { Clock } from '#src/shared/application/ports.js';
import type { OneTimeTokenRepository, OpenOrgInvite } from './ports.js';

/** Façade for organization: open, unexpired invitations of one org. */
export class ListOrgInvitationsUseCase {
  constructor(
    private readonly tokens: OneTimeTokenRepository,
    private readonly clock: Clock,
  ) {}

  execute(input: { orgId: string }): Promise<OpenOrgInvite[]> {
    return this.tokens.listOpenOrgInvites(input.orgId, this.clock.now());
  }
}
