import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { ok, type Result } from '../../../shared/domain/result.js';
import type { UserId } from '../domain/user.js';
import type {
  EmailSender,
  OneTimeTokenRepository,
  SecretTokenGenerator,
  UserRepository,
} from './ports.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type IssueEmailVerificationOutcome =
  'sent' | 'already_verified' | 'user_missing';

/**
 * Issues a fresh single-use token and emails it. Runs inside the caller's transaction (the outbox
 * consumer): if sending throws, the token row rolls back with it and the message is retried.
 */
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

      const { raw, hash } = this.generator.generate();
      await this.tokens.revokeOpen(user.id, 'email_verify');
      await this.tokens.issue({
        purpose: 'email_verify',
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(this.clock.now().getTime() + TOKEN_TTL_MS),
      });

      const link = new URL(this.verificationUrl);
      link.searchParams.set('token', raw);
      await this.emails.send({
        to: user.email.value,
        template: 'verify-email',
        data: { link: link.toString() },
      });
      return ok('sent' as const);
    });
  }
}
