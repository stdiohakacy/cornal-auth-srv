import type { UserId } from '../domain/user.js';
import {
  capturingEmailSender,
  InMemoryUserRepository,
} from './identity.test-support.js';
import { NotifyRegistrationAttemptUseCase } from './notify-registration-attempt.use-case.js';

describe('NotifyRegistrationAttemptUseCase', () => {
  it('emails the existing owner an account-exists notice with the login link', async () => {
    const users = new InMemoryUserRepository();
    const owner = users.seed('a@b.co');
    const email = capturingEmailSender();
    const useCase = new NotifyRegistrationAttemptUseCase(
      users,
      email.sender,
      'https://app.test/login',
    );

    expect(await useCase.execute({ userId: owner.id })).toEqual({
      ok: true,
      value: 'sent',
    });
    expect(email.sent).toEqual([
      {
        to: 'a@b.co',
        template: 'account-exists',
        data: { link: 'https://app.test/login' },
      },
    ]);
  });

  it('unknown user → user_missing, no email', async () => {
    const email = capturingEmailSender();
    const useCase = new NotifyRegistrationAttemptUseCase(
      new InMemoryUserRepository(),
      email.sender,
      'https://x',
    );

    expect(await useCase.execute({ userId: 'nope' as UserId })).toEqual({
      ok: true,
      value: 'user_missing',
    });
    expect(email.send).not.toHaveBeenCalled();
  });
});
