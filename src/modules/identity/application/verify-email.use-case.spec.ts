import {
  fixedClock,
  InMemoryOneTimeTokens,
  InMemoryUserRepository,
  NOW,
  passthroughUow,
  sequentialTokens,
} from './identity.test-support.js';
import { VerifyEmailUseCase } from './verify-email.use-case.js';

function setup() {
  const users = new InMemoryUserRepository();
  const tokens = new InMemoryOneTimeTokens();
  const useCase = new VerifyEmailUseCase(
    users,
    tokens,
    sequentialTokens(),
    passthroughUow,
    fixedClock,
  );
  return { users, tokens, useCase };
}

describe('VerifyEmailUseCase', () => {
  it('valid token verifies user', async () => {
    const { users, tokens, useCase } = setup();
    const user = users.seed('a@b.co');
    await tokens.issue({
      purpose: 'email_verify',
      userId: user.id,
      tokenHash: 'hash:raw-token',
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    expect(await useCase.execute({ token: 'raw-token' })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(users.rows.get(user.id)?.emailVerifiedAt).toEqual(NOW);
  });

  it('unknown token → InvalidToken', async () => {
    const { useCase } = setup();

    expect(await useCase.execute({ token: 'never-issued' })).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.INVALID_TOKEN' },
    });
  });
});
