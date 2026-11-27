import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { ok, type Result } from '../../../shared/domain/result.js';
import { Email } from '../domain/email.js';
import type { UserRepository } from './ports.js';

export type AcceptedOutcome = { readonly status: 'accepted' };
const ACCEPTED: AcceptedOutcome = { status: 'accepted' };

/**
 * "Forgot password". Always the same answer; for a known account it only records an event, and the
 * worker emails the link (the raw token never enters the outbox).
 */
export class RequestPasswordResetUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    email: string;
  }): Promise<Result<AcceptedOutcome, never>> {
    const email = Email.create(input.email);
    if (!email.ok) return ok(ACCEPTED);
    return this.uow.run(async () => {
      const user = await this.users.findByEmail(email.value);
      if (user) {
        user.requestPasswordReset(this.clock.now());
        await this.users.save(user);
      }
      return ok(ACCEPTED);
    });
  }
}
