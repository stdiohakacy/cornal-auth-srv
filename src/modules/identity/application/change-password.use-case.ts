import type { Clock, UnitOfWork } from '#src/shared/application/ports.js';
import { err, ok, type Result } from '#src/shared/domain/result.js';
import type { ServiceBusyError } from '#src/shared/domain/service-busy.error.js';
import {
  type AccountLockedError,
  InvalidCredentialsError,
  PasswordBreachedError,
  type WeakPasswordError,
} from '../domain/identity.errors.js';
import { checkPasswordPolicy } from '../domain/password-policy.js';
import type { UserId } from '../domain/user.js';
import { recordPasswordFailure } from './login-failures.js';
import type {
  BreachedPasswordChecker,
  LoginAttemptCounter,
  PasswordHasher,
  UserRepository,
} from './ports.js';

export type ChangePasswordError =
  | InvalidCredentialsError
  | AccountLockedError
  | WeakPasswordError
  | PasswordBreachedError
  | ServiceBusyError;

/**
 * Signed-in password change. The current password is the step-up proof: wrong guesses count
 * towards the same lockout as login, so this endpoint cannot be used to brute-force a password.
 */
export class ChangePasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly breaches: BreachedPasswordChecker,
    private readonly attempts: LoginAttemptCounter,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    userId: UserId;
    currentPassword: string;
    newPassword: string;
  }): Promise<Result<void, ChangePasswordError>> {
    const now = this.clock.now();
    const user = await this.users.findById(input.userId);
    if (!user || user.passwordHash === null)
      return err(new InvalidCredentialsError());
    const allowed = user.ensureCanAttemptLogin(now);
    if (!allowed.ok) return allowed;
    const policy = checkPasswordPolicy(input.newPassword);
    if (!policy.ok) return policy;

    const valid = await this.hasher.verify(
      input.currentPassword,
      user.passwordHash,
    );
    if (!valid.ok) return valid;
    if (!valid.value) {
      const recorded = await recordPasswordFailure(
        { attempts: this.attempts, users: this.users, uow: this.uow },
        user,
        now,
      );
      return recorded.ok ? err(new InvalidCredentialsError()) : recorded;
    }

    if (await this.breaches.isBreached(input.newPassword))
      return err(new PasswordBreachedError());
    const passwordHash = await this.hasher.hash(input.newPassword);
    if (!passwordHash.ok) return passwordHash;

    await this.uow.run(async () => {
      user.changePassword(passwordHash.value, now);
      await this.users.save(user);
      return ok(undefined);
    });
    // The password is changed either way; a failed reset only leaves the counter to expire.
    await this.attempts.reset(user.id);
    return ok(undefined);
  }
}
