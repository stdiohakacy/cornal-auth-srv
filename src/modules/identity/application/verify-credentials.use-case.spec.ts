import { err } from '../../../shared/domain/result.js';
import { ServiceBusyError } from '../../../shared/domain/service-busy.error.js';
import {
  fakeHasher,
  fixedClock,
  InMemoryAttemptCounter,
  InMemoryUserRepository,
  NOW,
  passthroughUow,
} from './identity.test-support.js';
import { VerifyCredentialsUseCase } from './verify-credentials.use-case.js';

const DUMMY = '$argon2id$dummy';
const PASSWORD = 'correct-horse-battery';

function setup() {
  const users = new InMemoryUserRepository();
  const counter = new InMemoryAttemptCounter();
  const { hasher, verify } = fakeHasher();
  const useCase = new VerifyCredentialsUseCase(
    users,
    hasher,
    counter,
    passthroughUow,
    fixedClock,
    DUMMY,
  );
  return { users, counter, verify, useCase };
}

describe('VerifyCredentialsUseCase', () => {
  it('unknown email verifies against the dummy hash and returns InvalidCredentials', async () => {
    const { verify, useCase } = setup();

    const result = await useCase.execute({
      email: 'ghost@b.co',
      password: PASSWORD,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.INVALID_CREDENTIALS' },
    });
    expect(verify).toHaveBeenCalledWith(PASSWORD, DUMMY);
  });

  it('malformed email still costs one dummy verification', async () => {
    const { verify, useCase } = setup();

    expect(
      (await useCase.execute({ email: 'not-an-email', password: PASSWORD })).ok,
    ).toBe(false);
    expect(verify).toHaveBeenCalledWith(PASSWORD, DUMMY);
  });

  it('wrong password increments counter; 5th failure locks and saves', async () => {
    const { users, counter, useCase } = setup();
    const user = users.seed('a@b.co');

    for (let i = 0; i < 4; i += 1)
      await useCase.execute({ email: 'a@b.co', password: 'wrong-password-x' });
    expect(users.rows.get(user.id)?.status).toBe('active');

    const fifth = await useCase.execute({
      email: 'a@b.co',
      password: 'wrong-password-x',
    });

    expect(fifth).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.INVALID_CREDENTIALS' },
    });
    // The counter restarts once the account is locked: a fresh budget after the lock expires.
    expect(counter.counts.has(user.id)).toBe(false);
    expect(users.rows.get(user.id)?.status).toBe('locked');
    expect(users.rows.get(user.id)?.lockedUntil).toEqual(
      new Date(NOW.getTime() + 15 * 60_000),
    );
  });

  it('locked user → AccountLocked without hashing', async () => {
    const { users, verify, useCase } = setup();
    const user = users.seed('a@b.co');
    user.lock(NOW, 15 * 60_000);

    const result = await useCase.execute({
      email: 'a@b.co',
      password: PASSWORD,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.ACCOUNT_LOCKED' },
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('correct password resets counter', async () => {
    const { users, counter, useCase } = setup();
    const user = users.seed('a@b.co');
    counter.counts.set(user.id, 3);

    const result = await useCase.execute({
      email: 'a@b.co',
      password: PASSWORD,
    });

    expect(result).toEqual({
      ok: true,
      value: { userId: user.id, emailVerified: false },
    });
    expect(counter.counts.has(user.id)).toBe(false);
  });

  it('lockout counter unavailable on a wrong password → ServiceBusyError (fail closed)', async () => {
    const { users, counter, useCase } = setup();
    users.seed('a@b.co');
    counter.unavailable = true;

    expect(
      await useCase.execute({ email: 'a@b.co', password: 'wrong-password-x' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'COMMON.SERVICE_UNAVAILABLE' },
    });
  });

  it('lockout counter unavailable on a correct password → ServiceBusyError', async () => {
    const { users, counter, useCase } = setup();
    users.seed('a@b.co');
    counter.unavailable = true;

    expect(
      await useCase.execute({ email: 'a@b.co', password: PASSWORD }),
    ).toMatchObject({
      ok: false,
      error: { code: 'COMMON.SERVICE_UNAVAILABLE' },
    });
  });

  it('busy → ServiceBusyError', async () => {
    const { users, verify, useCase } = setup();
    users.seed('a@b.co');
    verify.mockResolvedValueOnce(err(new ServiceBusyError(1)));

    expect(
      await useCase.execute({ email: 'a@b.co', password: PASSWORD }),
    ).toMatchObject({
      ok: false,
      error: { code: 'COMMON.SERVICE_UNAVAILABLE' },
    });
  });
});
