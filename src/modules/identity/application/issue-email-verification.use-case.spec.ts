import type { UserId } from '../domain/user.js';
import {
  capturingEmailSender,
  fixedClock,
  InMemoryOneTimeTokens,
  InMemoryUserRepository,
  NOW,
  passthroughUow,
  sequentialTokens,
} from './identity.test-support.js';
import { IssueEmailVerificationUseCase } from './issue-email-verification.use-case.js';

const URL_BASE = 'https://app.test/verify-email';

function setup() {
  const users = new InMemoryUserRepository();
  const tokens = new InMemoryOneTimeTokens();
  const email = capturingEmailSender();
  const useCase = new IssueEmailVerificationUseCase(
    users,
    tokens,
    sequentialTokens(),
    email.sender,
    passthroughUow,
    fixedClock,
    URL_BASE,
  );
  return { users, tokens, email, useCase };
}

describe('IssueEmailVerificationUseCase', () => {
  it('revokes open tokens, issues one hashed token, emails the raw token link', async () => {
    const { users, tokens, email, useCase } = setup();
    const user = users.seed('a@b.co');
    await useCase.execute({ userId: user.id });

    const result = await useCase.execute({ userId: user.id });

    expect(result).toEqual({ ok: true, value: 'sent' });
    expect(tokens.open(user.id)).toEqual([
      expect.objectContaining({
        purpose: 'email_verify',
        tokenHash: 'hash:raw-2',
        expiresAt: new Date(NOW.getTime() + 24 * 3600_000),
      }),
    ]);
    expect(email.sent.at(-1)).toEqual({
      to: 'a@b.co',
      template: 'verify-email',
      data: { link: `${URL_BASE}?token=raw-2` },
    });
  });

  it('already verified → no email', async () => {
    const { users, email, useCase } = setup();
    const user = users.seed('a@b.co');
    user.verifyEmail(NOW);

    expect(await useCase.execute({ userId: user.id })).toEqual({
      ok: true,
      value: 'already_verified',
    });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('unknown user → user_missing', async () => {
    const { useCase } = setup();

    expect(await useCase.execute({ userId: 'nope' as UserId })).toEqual({
      ok: true,
      value: 'user_missing',
    });
  });

  it('email failure propagates (so the outbox retries)', async () => {
    const { users, email, useCase } = setup();
    const user = users.seed('a@b.co');
    email.send.mockRejectedValueOnce(new Error('smtp down'));

    await expect(useCase.execute({ userId: user.id })).rejects.toThrow(
      'smtp down',
    );
  });
});
