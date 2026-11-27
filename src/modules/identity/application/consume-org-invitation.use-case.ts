import type { Clock, UnitOfWork } from '#src/shared/application/ports.js';
import { ok } from '#src/shared/domain/result.js';
import type { UserId } from '../domain/user.js';
import type {
  OneTimeTokenRepository,
  OrgInvitePayload,
  SecretTokenGenerator,
  UserRepository,
} from './ports.js';

/**
 * Façade for organization: consumes an invitation token for a signed-in user. Only a user whose
 * verified email is the invited one can use it; any other case returns undefined and consumes
 * nothing (one answer for every failure: no oracle). Joins the caller's transaction.
 */
export class ConsumeOrgInvitationUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: OneTimeTokenRepository,
    private readonly generator: SecretTokenGenerator,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    token: string;
    userId: string;
  }): Promise<OrgInvitePayload | undefined> {
    const result = await this.uow.run(async () => {
      // ids come from a verified access token: trusted boundary
      const user = await this.users.findById(input.userId as UserId);
      if (!user || user.emailVerifiedAt === null) return ok(undefined);
      return ok(
        await this.tokens.consumeOrgInvite(
          this.generator.hash(input.token),
          user.email.value,
          this.clock.now(),
        ),
      );
    });
    return result.ok ? result.value : undefined;
  }
}
