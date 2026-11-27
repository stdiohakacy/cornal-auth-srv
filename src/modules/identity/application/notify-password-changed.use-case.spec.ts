import {
  capturingEmailSender,
  InMemoryUserRepository,
} from './identity.test-support.js';
import { NotifyPasswordChangedUseCase } from './notify-password-changed.use-case.js';

describe('NotifyPasswordChangedUseCase', () => {
  it('sends password-changed to the owner', async () => {
    const users = new InMemoryUserRepository();
    const owner = users.seed('a@b.co');
    const email = capturingEmailSender();

    const result = await new NotifyPasswordChangedUseCase(
      users,
      email.sender,
      'https://app.test/login',
    ).execute({
      userId: owner.id,
    });

    expect(result).toEqual({ ok: true, value: 'sent' });
    expect(email.sent).toEqual([
      {
        to: 'a@b.co',
        template: 'password-changed',
        data: { link: 'https://app.test/login' },
      },
    ]);
  });
});
