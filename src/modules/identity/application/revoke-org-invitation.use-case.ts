import type { UnitOfWork } from '#src/shared/application/ports.js';
import { ok } from '#src/shared/domain/result.js';
import type { OneTimeTokenRepository } from './ports.js';

/** Façade for organization: revokes one open invitation; false when there is none. */
export class RevokeOrgInvitationUseCase {
  constructor(
    private readonly tokens: OneTimeTokenRepository,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(input: {
    orgId: string;
    invitationId: string;
  }): Promise<boolean> {
    const result = await this.uow.run(async () =>
      ok(await this.tokens.revokeOrgInvite(input.orgId, input.invitationId)),
    );
    return result.ok && result.value;
  }
}
