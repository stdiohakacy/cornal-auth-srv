import {
  fixedClock,
  InMemoryUserRepository,
  passthroughUow,
} from './identity.test-support.js';
import { RequestPasswordResetUseCase } from './request-password-reset.use-case.js';

const ACCEPTED = { ok: true, value: { status: 'accepted' } };

function setup() {
  const users = new InMemoryUserRepository();
  return {
    users,
    useCase: new RequestPasswordResetUseCase(users, passthroughUow, fixedClock),
  };
}

describe('RequestPasswordResetUseCase', () => {
  it('existing user → event recorded, accepted', async () => {
    const { users, useCase } = setup();
    const user = users.seed('a@b.co');

    expect(await useCase.execute({ email: 'A@B.co' })).toEqual(ACCEPTED);
    expect(user.pendingEvents.map((e) => e.type)).toEqual([
      'identity.user.password_reset_requested',
    ]);
  });

  it('unknown or malformed email → accepted, nothing saved', async () => {
    const { users, useCase } = setup();
    const save = vi.spyOn(users, 'save');

    expect(await useCase.execute({ email: 'ghost@b.co' })).toEqual(ACCEPTED);
    expect(await useCase.execute({ email: 'not-an-email' })).toEqual(ACCEPTED);
    expect(save).not.toHaveBeenCalled();
  });
});
