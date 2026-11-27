import { err } from '#src/shared/domain/result.js';
import { ChangePasswordUseCase } from './change-password.use-case.js';
import {
  fakeBreachChecker,
  fakeHasher,
  fixedClock,
  InMemoryAttemptCounter,
  InMemoryUserRepository,
  NOW,
  passthroughUow,
} from './identity.test-support.js';

const CURRENT = 'correct-horse-battery';
const NEXT = 'a-brand-new-passphrase';

function setup() {
  const users = new InMemoryUserRepository();
  const counter = new InMemoryAttemptCounter();
  const { hasher, hash, verify } = fakeHasher();
  const breached = fakeBreachChecker();
  const useCase = new ChangePasswordUseCase(
    users,
    hasher,
    breached.checker,
    counter,
    passthroughUow,
    fixedClock,
  );
  const user = users.seed('a@b.co', `hashed:${CURRENT}`);
  user.pullEvents();
  return { users, counter, hash, verify, breached, useCase, user };
}

describe('ChangePasswordUseCase', () => {
  it('changes the password', async () => {
    const { users, useCase, user } = setup();

    expect(
      await useCase.execute({
        userId: user.id,
        currentPassword: CURRENT,
        newPassword: NEXT,
      }),
    ).toEqual({
      ok: true,
      value: undefined,
    });
    expect(users.rows.get(user.id)?.passwordHash).toBe(`hashed:${NEXT}`);
    expect(user.pendingEvents.map((e) => e.type)).toEqual([
      'identity.user.password_changed',
    ]);
  });

  it('wrong current password → InvalidCredentials and counted; 5th locks', async () => {
    const { counter, useCase, user } = setup();
    const attempt = () =>
      useCase.execute({
        userId: user.id,
        currentPassword: 'wrong-password-x',
        newPassword: NEXT,
      });

    expect(await attempt()).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.INVALID_CREDENTIALS' },
    });
    expect(counter.counts.get(user.id)).toBe(1);
    for (let i = 0; i < 4; i += 1) await attempt();

    expect(user.status).toBe('locked');
    expect(user.passwordHash).toBe(`hashed:${CURRENT}`);
  });

  it('locked account → AccountLocked without hashing', async () => {
    const { verify, hash, useCase, user } = setup();
    user.lock(NOW, 60_000);

    expect(
      await useCase.execute({
        userId: user.id,
        currentPassword: CURRENT,
        newPassword: NEXT,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.ACCOUNT_LOCKED' },
    });
    expect(verify).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
  });

  it('weak new password → WeakPassword before verifying', async () => {
    const { verify, useCase, user } = setup();

    expect(
      await useCase.execute({
        userId: user.id,
        currentPassword: CURRENT,
        newPassword: 'short',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.WEAK_PASSWORD' },
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('breached → PasswordBreached, nothing saved', async () => {
    const { breached, hash, useCase, user } = setup();
    breached.isBreached.mockResolvedValueOnce(true);

    expect(
      await useCase.execute({
        userId: user.id,
        currentPassword: CURRENT,
        newPassword: NEXT,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.PASSWORD_BREACHED' },
    });
    expect(hash).not.toHaveBeenCalled();
    expect(user.passwordHash).toBe(`hashed:${CURRENT}`);
  });

  it('busy hasher on verify → ServiceBusyError', async () => {
    const { verify, useCase, user } = setup();
    const { ServiceBusyError } =
      await import('#src/shared/domain/service-busy.error.js');
    verify.mockResolvedValueOnce(err(new ServiceBusyError(1)));

    expect(
      await useCase.execute({
        userId: user.id,
        currentPassword: CURRENT,
        newPassword: NEXT,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'COMMON.SERVICE_UNAVAILABLE' },
    });
  });
});
