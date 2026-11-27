import type { UnitOfWork } from '#src/shared/application/ports.js';
import { ok, type Result } from '#src/shared/domain/result.js';
import type { ServiceBusyError } from '#src/shared/domain/service-busy.error.js';
import type { User } from '../domain/user.js';
import type { LoginAttemptCounter, UserRepository } from './ports.js';

const MAX_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60_000;

/**
 * Counts a failed password proof (login or change-password); the MAX_FAILURES-th one locks the
 * account. Counter unavailable ⇒ ServiceBusyError (fail closed).
 */
export async function recordPasswordFailure(
  deps: {
    attempts: LoginAttemptCounter;
    users: UserRepository;
    uow: UnitOfWork;
  },
  user: User,
  now: Date,
): Promise<Result<void, ServiceBusyError>> {
  const failures = await deps.attempts.registerFailure(user.id);
  if (!failures.ok) return failures;
  if (failures.value < MAX_FAILURES) return ok(undefined);
  user.lock(now, LOCK_DURATION_MS);
  await deps.uow.run(async () => {
    await deps.users.save(user);
    return ok(undefined);
  });
  // Fresh budget once the lock expires. A failed reset only means the window ends naturally.
  await deps.attempts.reset(user.id);
  return ok(undefined);
}
