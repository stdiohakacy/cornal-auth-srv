import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import type { ServiceBusyError } from '../../../shared/domain/service-busy.error.js';
import { Email } from '../domain/email.js';
import {
  type AccountLockedError,
  InvalidCredentialsError,
} from '../domain/identity.errors.js';
import type { User, UserId } from '../domain/user.js';
import type {
  LoginAttemptCounter,
  PasswordHasher,
  UserRepository,
} from './ports.js';

const MAX_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60_000;

export type VerifiedCredentials = {
  readonly userId: UserId;
  readonly emailVerified: boolean;
  /** Copied into access tokens (`uv`) so a bump revokes every token of the user. */
  readonly tokenVersion: number;
};
export type VerifyCredentialsError =
  InvalidCredentialsError | AccountLockedError | ServiceBusyError;

/**
 * Façade used by the session module's login. Rate limiting already ran (HTTP guard); this adds
 * per-account lockout. Unknown emails cost one dummy Argon2 run so timing does not reveal them.
 */
export class VerifyCredentialsUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly attempts: LoginAttemptCounter,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly dummyHash: string,
  ) {}

  async execute(input: {
    email: string;
    password: string;
  }): Promise<Result<VerifiedCredentials, VerifyCredentialsError>> {
    const now = this.clock.now();
    const email = Email.create(input.email);
    const user = email.ok
      ? await this.users.findByEmail(email.value)
      : undefined;

    if (user) {
      const allowed = user.ensureCanAttemptLogin(now);
      if (!allowed.ok) return allowed;
    }

    const valid = await this.hasher.verify(
      input.password,
      user?.passwordHash ?? this.dummyHash,
    );
    if (!valid.ok) return valid;
    if (!user || user.passwordHash === null || !valid.value) {
      if (user) {
        const recorded = await this.recordFailure(user, now);
        if (!recorded.ok) return recorded;
      }
      return err(new InvalidCredentialsError());
    }

    const reset = await this.attempts.reset(user.id);
    if (!reset.ok) return reset;
    if (user.clearExpiredLock(now)) {
      await this.uow.run(async () => {
        await this.users.save(user);
        return ok(undefined);
      });
    }
    return ok({
      userId: user.id,
      emailVerified: user.emailVerifiedAt !== null,
      tokenVersion: user.tokenVersion,
    });
  }

  /** Counts the failure; the MAX_FAILURES-th one locks the account. */
  private async recordFailure(
    user: User,
    now: Date,
  ): Promise<Result<void, ServiceBusyError>> {
    const failures = await this.attempts.registerFailure(user.id);
    if (!failures.ok) return failures;
    if (failures.value < MAX_FAILURES) return ok(undefined);
    user.lock(now, LOCK_DURATION_MS);
    await this.uow.run(async () => {
      await this.users.save(user);
      return ok(undefined);
    });
    // Fresh budget once the lock expires. A failed reset only means the window ends naturally.
    await this.attempts.reset(user.id);
    return ok(undefined);
  }
}
