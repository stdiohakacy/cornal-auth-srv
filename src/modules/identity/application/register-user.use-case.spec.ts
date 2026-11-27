import { err } from '#src/shared/domain/result.js';
import { ServiceBusyError } from '#src/shared/domain/service-busy.error.js';
import {
  fakeBreachChecker,
  fakeHasher,
  fixedClock,
  InMemoryUserRepository,
  passthroughUow,
} from './identity.test-support.js';
import { RegisterUserUseCase } from './register-user.use-case.js';

const ACCEPTED = { ok: true, value: { status: 'accepted' } };

function setup() {
  const users = new InMemoryUserRepository();
  const { hasher, hash } = fakeHasher();
  const breached = fakeBreachChecker();
  return {
    users,
    hash,
    breached,
    useCase: new RegisterUserUseCase(
      users,
      hasher,
      breached.checker,
      passthroughUow,
      fixedClock,
    ),
  };
}

describe('RegisterUserUseCase', () => {
  it('registers and saves with hashed password', async () => {
    const { users, useCase } = setup();

    const result = await useCase.execute({
      email: ' Alice@Example.com',
      password: 'correct-horse-battery',
    });

    expect(result).toEqual(ACCEPTED);
    const saved = [...users.rows.values()][0];
    expect(saved?.email.value).toBe('alice@example.com');
    expect(saved?.passwordHash).toBe('hashed:correct-horse-battery');
    expect(saved?.pendingEvents.map((e) => e.type)).toEqual([
      'identity.user.registered',
    ]);
  });

  it('weak password → WeakPassword, hasher not called', async () => {
    const { useCase, hash } = setup();

    const result = await useCase.execute({
      email: 'a@b.co',
      password: 'short',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.WEAK_PASSWORD' },
    });
    expect(hash).not.toHaveBeenCalled();
  });

  it('breached password → PasswordBreached, hasher not called', async () => {
    const { useCase, hash, breached } = setup();
    breached.isBreached.mockResolvedValueOnce(true);

    expect(
      await useCase.execute({
        email: 'a@b.co',
        password: 'correct-horse-battery',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.PASSWORD_BREACHED' },
    });
    expect(hash).not.toHaveBeenCalled();
  });

  it('invalid email → InvalidEmail', async () => {
    const { useCase } = setup();

    expect(
      await useCase.execute({
        email: 'nope',
        password: 'correct-horse-battery',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.INVALID_EMAIL' },
    });
  });

  it('taken email → same accepted answer, existing owner is notified, nothing new saved', async () => {
    const { users, hash, useCase } = setup();
    const owner = users.seed('a@b.co');

    const result = await useCase.execute({
      email: 'A@B.CO',
      password: 'correct-horse-battery',
    });

    expect(result).toEqual(ACCEPTED);
    expect(users.rows.size).toBe(1);
    expect(owner.pendingEvents.map((e) => e.type)).toEqual([
      'identity.user.registration_attempted',
    ]);
    expect(hash).toHaveBeenCalledTimes(1); // same Argon2 cost as a real registration
  });

  it('a racing duplicate caught by the unique index is also accepted', async () => {
    const { users, useCase } = setup();
    users.failNextSaveWithEmailTaken = true;

    expect(
      await useCase.execute({
        email: 'a@b.co',
        password: 'correct-horse-battery',
      }),
    ).toEqual(ACCEPTED);
  });

  it('busy hasher → ServiceBusyError, nothing saved', async () => {
    const { users, hash, useCase } = setup();
    hash.mockResolvedValueOnce(err(new ServiceBusyError(1)));

    const result = await useCase.execute({
      email: 'a@b.co',
      password: 'correct-horse-battery',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'COMMON.SERVICE_UNAVAILABLE' },
    });
    expect(users.rows.size).toBe(0);
  });
});
