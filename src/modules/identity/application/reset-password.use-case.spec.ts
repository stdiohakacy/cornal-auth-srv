import { err } from '../../../shared/domain/result.js';
import { ServiceBusyError } from '../../../shared/domain/service-busy.error.js';
import {
  fakeBreachChecker,
  fakeHasher,
  fixedClock,
  InMemoryOneTimeTokens,
  InMemoryUserRepository,
  NOW,
  passthroughUow,
  sequentialTokens,
} from './identity.test-support.js';
import { ResetPasswordUseCase } from './reset-password.use-case.js';

const NEW_PASSWORD = 'a-brand-new-passphrase';

async function setup() {
  const users = new InMemoryUserRepository();
  const tokens = new InMemoryOneTimeTokens();
  const { hasher, hash } = fakeHasher();
  const breached = fakeBreachChecker();
  const useCase = new ResetPasswordUseCase(
    users,
    tokens,
    sequentialTokens(),
    hasher,
    breached.checker,
    passthroughUow,
    fixedClock,
  );
  const user = users.seed('a@b.co');
  const expiresAt = new Date(NOW.getTime() + 60_000);
  await tokens.issue({
    purpose: 'password_reset',
    userId: user.id,
    tokenHash: 'hash:good',
    expiresAt,
  });
  await tokens.issue({
    purpose: 'password_reset',
    userId: user.id,
    tokenHash: 'hash:other',
    expiresAt,
  });
  return { users, tokens, hash, breached, useCase, user };
}

describe('ResetPasswordUseCase', () => {
  it('valid token → new hash, tokenVersion+1, token consumed, other reset tokens revoked', async () => {
    const { users, tokens, useCase, user } = await setup();

    expect(
      await useCase.execute({ token: 'good', password: NEW_PASSWORD }),
    ).toEqual({ ok: true, value: undefined });
    const saved = users.rows.get(user.id);
    expect(saved?.passwordHash).toBe(`hashed:${NEW_PASSWORD}`);
    expect(saved?.tokenVersion).toBe(1);
    expect(tokens.open(user.id)).toEqual([]);
  });

  it('unknown token → InvalidToken and hasher not called', async () => {
    const { hash, useCase } = await setup();

    expect(
      await useCase.execute({ token: 'forged', password: NEW_PASSWORD }),
    ).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.INVALID_TOKEN' },
    });
    expect(hash).not.toHaveBeenCalled();
  });

  it('breached → PasswordBreached, token not consumed', async () => {
    const { tokens, breached, useCase, user } = await setup();
    breached.isBreached.mockResolvedValueOnce(true);

    expect(
      await useCase.execute({ token: 'good', password: NEW_PASSWORD }),
    ).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.PASSWORD_BREACHED' },
    });
    expect(tokens.open(user.id)).toHaveLength(2);
  });

  it('weak → WeakPassword', async () => {
    const { useCase } = await setup();

    expect(
      await useCase.execute({ token: 'good', password: 'short' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.WEAK_PASSWORD' },
    });
  });

  it('busy hasher → ServiceBusyError, token not consumed', async () => {
    const { tokens, hash, useCase, user } = await setup();
    hash.mockResolvedValueOnce(err(new ServiceBusyError(1)));

    expect(
      await useCase.execute({ token: 'good', password: NEW_PASSWORD }),
    ).toMatchObject({
      ok: false,
      error: { code: 'COMMON.SERVICE_UNAVAILABLE' },
    });
    expect(tokens.open(user.id)).toHaveLength(2);
  });
});
