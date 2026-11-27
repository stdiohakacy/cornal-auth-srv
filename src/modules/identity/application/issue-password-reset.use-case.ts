import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { ok, type Result } from '../../../shared/domain/result.js';
import type { UserId } from '../domain/user.js';
import { issueTokenLink } from './issue-token-link.js';
import type {
  EmailSender,
  OneTimeTokenRepository,
  SecretTokenGenerator,
  UserRepository,
} from './ports.js';

const TOKEN_TTL_MS = 30 * 60 * 1000;

/** Worker side of "forgot password": a single-use, 30-minute reset link. */
export class IssuePasswordResetUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: OneTimeTokenRepository,
    private readonly generator: SecretTokenGenerator,
    private readonly emails: EmailSender,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly resetUrl: string,
  ) {}

  async execute(input: {
    userId: UserId;
  }): Promise<Result<'sent' | 'user_missing', never>> {
    return this.uow.run(async () => {
      const user = await this.users.findById(input.userId);
      if (!user) return ok('user_missing' as const);
      await issueTokenLink(
        { tokens: this.tokens, generator: this.generator, emails: this.emails },
        {
          purpose: 'password_reset',
          ttlMs: TOKEN_TTL_MS,
          template: 'password-reset',
          baseUrl: this.resetUrl,
        },
        user,
        this.clock.now(),
      );
      return ok('sent' as const);
    });
  }
}
