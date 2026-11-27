import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import type { ServiceBusyError } from '../../../shared/domain/service-busy.error.js';
import {
  InvalidTokenError,
  PasswordBreachedError,
  type WeakPasswordError,
} from '../domain/identity.errors.js';
import { checkPasswordPolicy } from '../domain/password-policy.js';
import type {
  BreachedPasswordChecker,
  OneTimeTokenRepository,
  PasswordHasher,
  SecretTokenGenerator,
  UserRepository,
} from './ports.js';

export type ResetPasswordError =
  | InvalidTokenError
  | WeakPasswordError
  | PasswordBreachedError
  | ServiceBusyError;

/**
 * Cheap checks first (policy, token peek, breach screen), Argon2 outside the transaction, then the
 * token is consumed atomically with the user update. A rejected attempt never burns the token.
 */
export class ResetPasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: OneTimeTokenRepository,
    private readonly generator: SecretTokenGenerator,
    private readonly hasher: PasswordHasher,
    private readonly breaches: BreachedPasswordChecker,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    token: string;
    password: string;
  }): Promise<Result<void, ResetPasswordError>> {
    const policy = checkPasswordPolicy(input.password);
    if (!policy.ok) return policy;
    const tokenHash = this.generator.hash(input.token);
    if (
      !(await this.tokens.findValid(
        'password_reset',
        tokenHash,
        this.clock.now(),
      ))
    ) {
      return err(new InvalidTokenError());
    }
    if (await this.breaches.isBreached(input.password))
      return err(new PasswordBreachedError());

    const passwordHash = await this.hasher.hash(input.password);
    if (!passwordHash.ok) return passwordHash;

    return this.uow.run(async () => {
      const now = this.clock.now();
      const owner = await this.tokens.consume('password_reset', tokenHash, now);
      if (!owner) return err(new InvalidTokenError()); // lost a race with another reset
      const user = await this.users.findById(owner.userId);
      if (!user) return err(new InvalidTokenError());
      user.resetPassword(passwordHash.value, now);
      await this.tokens.revokeOpen(user.id, 'password_reset');
      await this.users.save(user);
      return ok(undefined);
    });
  }
}
