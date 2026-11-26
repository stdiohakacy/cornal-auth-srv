import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { ok, type Result } from '../../../shared/domain/result.js';
import type { ServiceBusyError } from '../../../shared/domain/service-busy.error.js';
import { Email } from '../domain/email.js';
import {
  EmailTakenError,
  type InvalidEmailError,
  type WeakPasswordError,
} from '../domain/identity.errors.js';
import { checkPasswordPolicy } from '../domain/password-policy.js';
import { User } from '../domain/user.js';
import type { PasswordHasher, UserRepository } from './ports.js';

export type RegisterUserInput = {
  readonly email: string;
  readonly password: string;
};
export type RegisterUserError =
  InvalidEmailError | WeakPasswordError | ServiceBusyError;
/** Identical for new and existing emails: the response never reveals whether an account exists. */
export type RegisterUserOutcome = { readonly status: 'accepted' };

const ACCEPTED: RegisterUserOutcome = { status: 'accepted' };

/**
 * Creates the account, or notifies the existing owner. Both paths pay one Argon2 hash and answer
 * the same. Emails go out from the worker (identity.user.registered / registration_attempted).
 */
export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: RegisterUserInput,
  ): Promise<Result<RegisterUserOutcome, RegisterUserError>> {
    const policy = checkPasswordPolicy(input.password);
    if (!policy.ok) return policy;
    const email = Email.create(input.email);
    if (!email.ok) return email;

    // Argon2 runs outside the transaction (never hold a DB connection while hashing), and runs
    // for existing emails too, so both paths cost the same time.
    const passwordHash = await this.hasher.hash(input.password);
    if (!passwordHash.ok) return passwordHash;

    try {
      return await this.uow.run(async () => {
        const now = this.clock.now();
        const existing = await this.users.findByEmail(email.value);
        if (existing) {
          existing.noteRegistrationAttempt(now);
          await this.users.save(existing);
          return ok(ACCEPTED);
        }
        await this.users.save(
          User.register({
            email: email.value,
            passwordHash: passwordHash.value,
            now,
          }),
        );
        return ok(ACCEPTED);
      });
    } catch (error) {
      // Lost the race on the unique index against a concurrent registration of the same email.
      if (error instanceof EmailTakenError) return ok(ACCEPTED);
      throw error;
    }
  }
}
