import { GetUserEmailsUseCase } from './get-user-emails.use-case.js';
import { InMemoryUserRepository } from './identity.test-support.js';

describe('GetUserEmailsUseCase', () => {
  it('returns emails for known ids and skips unknown ones', async () => {
    const users = new InMemoryUserRepository();
    const a = users.seed('a@b.co');
    const b = users.seed('c@d.co');

    const emails = await new GetUserEmailsUseCase(users).execute({
      userIds: [a.id, b.id, 'missing'],
    });

    expect(Object.fromEntries(emails)).toEqual({
      [a.id]: 'a@b.co',
      [b.id]: 'c@d.co',
    });
  });
});
