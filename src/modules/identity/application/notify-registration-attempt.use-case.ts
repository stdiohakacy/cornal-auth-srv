import { ok, type Result } from '#src/shared/domain/result.js';
import type { UserId } from '../domain/user.js';
import type { EmailSender, UserRepository } from './ports.js';

export type NotifyRegistrationAttemptOutcome = 'sent' | 'user_missing';

/** Tells an account owner that someone tried to sign up with their email (sign-in link only). */
export class NotifyRegistrationAttemptUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly emails: EmailSender,
    private readonly loginUrl: string,
  ) {}

  async execute(input: {
    userId: UserId;
  }): Promise<Result<NotifyRegistrationAttemptOutcome, never>> {
    const user = await this.users.findById(input.userId);
    if (!user) return ok('user_missing');
    await this.emails.send({
      to: user.email.value,
      template: 'account-exists',
      data: { link: this.loginUrl },
    });
    return ok('sent');
  }
}
