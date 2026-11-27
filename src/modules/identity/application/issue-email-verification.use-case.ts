import type { Clock, UnitOfWork } from '#src/shared/application/ports.js';
import { ok, type Result } from '#src/shared/domain/result.js';
import type { UserId } from '../domain/user.js';
import { issueTokenLink } from './issue-token-link.js';
import type {
  EmailSender,
  OneTimeTokenRepository,
  SecretTokenGenerator,
  UserRepository,
} from './ports.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type IssueEmailVerificationOutcome =
  'sent' | 'already_verified' | 'user_missing';

/** Worker side of registration: single-use verification link (see issueTokenLink). */
export class IssueEmailVerificationUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: OneTimeTokenRepository,
    private readonly generator: SecretTokenGenerator,
    private readonly emails: EmailSender,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly verificationUrl: string,
  ) {}

  async execute(input: {
    userId: UserId;
  }): Promise<Result<IssueEmailVerificationOutcome, never>> {
    return this.uow.run(async () => {
      const user = await this.users.findById(input.userId);
      if (!user) return ok('user_missing' as const);
      if (user.emailVerifiedAt !== null) return ok('already_verified' as const);
      await issueTokenLink(
        { tokens: this.tokens, generator: this.generator, emails: this.emails },
        {
          spec: {
            purpose: 'email_verify',
            ttlMs: TOKEN_TTL_MS,
            template: 'verify-email',
            baseUrl: this.verificationUrl,
          },
          user,
          now: this.clock.now(),
        },
      );
      return ok('sent' as const);
    });
  }
}
