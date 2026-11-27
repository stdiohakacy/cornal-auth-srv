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
import { IssuePasswordResetUseCase } from './issue-password-reset.use-case.js';

describe('IssuePasswordResetUseCase', () => {
  it('issues a 30-min password_reset token and emails the reset link', async () => {
    const users = new InMemoryUserRepository();
    const tokens = new InMemoryOneTimeTokens();
    const email = capturingEmailSender();
    const useCase = new IssuePasswordResetUseCase(
      users,
      tokens,
      sequentialTokens(),
      email.sender,
      passthroughUow,
      fixedClock,
      'https://app.test/reset-password',
    );
    const user = users.seed('a@b.co');

    expect(await useCase.execute({ userId: user.id })).toEqual({
      ok: true,
      value: 'sent',
    });
    expect(tokens.open(user.id)).toEqual([
      expect.objectContaining({
        purpose: 'password_reset',
        tokenHash: 'hash:raw-1',
        expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      }),
    ]);
    expect(email.sent).toEqual([
      {
        to: 'a@b.co',
        template: 'password-reset',
        data: { link: 'https://app.test/reset-password?token=raw-1' },
      },
    ]);
    expect(await useCase.execute({ userId: 'nope' as UserId })).toEqual({
      ok: true,
      value: 'user_missing',
    });
  });
});
