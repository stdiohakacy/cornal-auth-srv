import { User, type UserId } from '../domain/user.js';
import { GetUserAuthStateUseCase } from './get-user-auth-state.use-case.js';
import {
  fixedClock,
  InMemoryUserRepository,
  NOW,
} from './identity.test-support.js';

function setup() {
  const users = new InMemoryUserRepository();
  return { users, useCase: new GetUserAuthStateUseCase(users, fixedClock) };
}

describe('GetUserAuthStateUseCase', () => {
  it('active → canAuthenticate with the current tokenVersion', async () => {
    const { users, useCase } = setup();
    const user = users.seed('a@b.co');

    expect(await useCase.execute({ userId: user.id })).toEqual({
      tokenVersion: 0,
      canAuthenticate: true,
    });
  });

  it('disabled → false', async () => {
    const { users, useCase } = setup();
    const seeded = users.seed('a@b.co');
    const disabled = User.reconstitute(
      seeded.id,
      {
        email: seeded.email,
        emailVerifiedAt: null,
        passwordHash: null,
        status: 'disabled',
        lockedUntil: null,
        tokenVersion: 3,
        createdAt: NOW,
      },
      1,
    );
    users.rows.set(disabled.id, disabled);

    expect(await useCase.execute({ userId: disabled.id })).toEqual({
      tokenVersion: 3,
      canAuthenticate: false,
    });
  });

  it('lock in force → false; expired lock → true', async () => {
    const { users, useCase } = setup();
    const user = users.seed('a@b.co');
    user.lock(new Date(NOW.getTime() - 60_000), 120_000);
    expect(await useCase.execute({ userId: user.id })).toMatchObject({
      canAuthenticate: false,
    });

    user.lock(new Date(NOW.getTime() - 120_000), 60_000);
    expect(await useCase.execute({ userId: user.id })).toMatchObject({
      canAuthenticate: true,
    });
  });

  it('unknown → undefined', async () => {
    const { useCase } = setup();

    expect(await useCase.execute({ userId: 'nope' as UserId })).toBeUndefined();
  });
});
