import { Session } from '../domain/session.js';
import { RefreshSessionUseCase } from './refresh-session.use-case.js';
import {
  clockAt,
  fakeAccessTokens,
  FakeAuthState,
  InMemorySessionRepository,
  NOW,
  passthroughUow,
  sequentialRefreshTokens,
  TTL,
} from './session.test-support.js';

const LATER = new Date(NOW.getTime() + 60_000);

async function setup(at = LATER) {
  const sessions = new InMemorySessionRepository();
  const authState = new FakeAuthState();
  authState.states.set('u1', { tokenVersion: 2, canAuthenticate: true });
  const tokens = fakeAccessTokens();
  const session = Session.start({
    userId: 'u1',
    refreshHash: 'hash:original',
    now: NOW,
    idleTtlMs: TTL.idleSeconds * 1000,
    absoluteTtlMs: TTL.absoluteSeconds * 1000,
    amr: ['pwd'],
    ip: null,
    userAgent: null,
  });
  await sessions.save(session);
  const useCase = new RefreshSessionUseCase(
    authState,
    sessions,
    sequentialRefreshTokens(),
    tokens.service,
    passthroughUow,
    clockAt(at),
    TTL,
  );
  const refresh = (secret: string) =>
    useCase.execute({
      refreshToken: `${session.id}.${secret}`,
      ip: '5.6.7.8',
      userAgent: 'ua-2',
    });
  return { sessions, authState, tokens, session, useCase, refresh };
}

describe('RefreshSessionUseCase', () => {
  it('rotates and issues new tokens', async () => {
    const { session, refresh } = await setup();

    const result = await refresh('original');

    expect(result).toEqual({
      ok: true,
      value: {
        accessToken: `access:${session.id}:2`,
        expiresIn: 600,
        refreshToken: `${session.id}.secret-1`,
        refreshMaxAgeSeconds: TTL.idleSeconds,
      },
    });
    expect(session.snapshot.refreshHash).toBe('hash:secret-1');
  });

  it('reuse → session revoked and saved, SessionInvalid', async () => {
    const { sessions, authState, session, refresh } = await setup();
    await refresh('original'); // rotated at LATER: "original" is now prev[0]
    const afterGrace = new RefreshSessionUseCase(
      authState,
      sessions,
      sequentialRefreshTokens(),
      fakeAccessTokens().service,
      passthroughUow,
      clockAt(new Date(LATER.getTime() + 60_000)),
      TTL,
    );
    const savesBefore = sessions.saves;

    const result = await afterGrace.execute({
      refreshToken: `${session.id}.original`,
      ip: null,
      userAgent: null,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SESSION.INVALID' },
    });
    expect(session.snapshot.revokeReason).toBe('reuse_detected');
    expect(sessions.saves).toBe(savesBefore + 1);
  });

  it('racing version → RefreshConflict', async () => {
    const { sessions, refresh } = await setup();
    sessions.conflictOnNextSave = true;

    expect(await refresh('original')).toMatchObject({
      ok: false,
      error: { code: 'SESSION.REFRESH_CONFLICT' },
    });
  });

  it('inactive user → session revoked, SessionInvalid', async () => {
    const { authState, session, refresh } = await setup();
    authState.states.set('u1', { tokenVersion: 2, canAuthenticate: false });

    expect(await refresh('original')).toMatchObject({
      ok: false,
      error: { code: 'SESSION.INVALID' },
    });
    expect(session.snapshot.revokeReason).toBe('user_inactive');
  });

  it('garbage or unknown session → SessionInvalid', async () => {
    const { useCase } = await setup();

    expect(
      await useCase.execute({
        refreshToken: 'garbage',
        ip: null,
        userAgent: null,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'SESSION.INVALID' },
    });
    expect(
      await useCase.execute({
        refreshToken: '01a21877-9b5a-7147-b111-fa795f1f2ee1.x',
        ip: null,
        userAgent: null,
      }),
    ).toMatchObject({ ok: false, error: { code: 'SESSION.INVALID' } });
  });
});
