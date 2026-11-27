import { Session } from '../domain/session.js';
import { LogoutUseCase } from './logout.use-case.js';
import {
  clockAt,
  InMemorySessionRepository,
  NOW,
  passthroughUow,
  sequentialRefreshTokens,
  TTL,
} from './session.test-support.js';

async function setup() {
  const sessions = new InMemorySessionRepository();
  const session = Session.start({
    userId: 'u1',
    refreshHash: 'hash:current',
    now: NOW,
    idleTtlMs: TTL.idleSeconds * 1000,
    absoluteTtlMs: TTL.absoluteSeconds * 1000,
    amr: ['pwd'],
    ip: null,
    userAgent: null,
  });
  await sessions.save(session);
  const useCase = new LogoutUseCase(
    sessions,
    sequentialRefreshTokens(),
    passthroughUow,
    clockAt(NOW),
  );
  return { session, useCase };
}

describe('LogoutUseCase', () => {
  it('revokes the session presented with its current token', async () => {
    const { session, useCase } = await setup();

    expect(
      await useCase.execute({ refreshToken: `${session.id}.current` }),
    ).toEqual({ ok: true, value: undefined });
    expect(session.snapshot.revokeReason).toBe('logout');
  });

  it('a wrong secret for a real session does not revoke it', async () => {
    const { session, useCase } = await setup();

    expect(
      await useCase.execute({ refreshToken: `${session.id}.forged` }),
    ).toEqual({ ok: true, value: undefined });
    expect(session.snapshot.revokedAt).toBeNull();
  });

  it('unknown or garbage token is ok', async () => {
    const { useCase } = await setup();

    expect(await useCase.execute({ refreshToken: 'garbage' })).toEqual({
      ok: true,
      value: undefined,
    });
  });
});
