import { ok, type Result } from '#src/shared/domain/result.js';
import type { UserId } from '../domain/user.js';
import type { EmailSender, UserRepository } from './ports.js';

/** Security notice after any password change (contains no secret, only a sign-in link). */
export class NotifyPasswordChangedUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly emails: EmailSender,
    private readonly loginUrl: string,
  ) {}

  async execute(input: {
    userId: UserId;
  }): Promise<Result<'sent' | 'user_missing', never>> {
    const user = await this.users.findById(input.userId);
    if (!user) return ok('user_missing');
    await this.emails.send({
      to: user.email.value,
      template: 'password-changed',
      data: { link: this.loginUrl },
    });
    return ok('sent');
  }
}
