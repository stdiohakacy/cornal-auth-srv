import { LoginUseCase } from './login.use-case.js';
import {
  clockAt,
  fakeAccessTokens,
  FakeCredentials,
  FakeOrgContexts,
  ORG_CONTEXT,
  InMemorySessionRepository,
  NOW,
  passthroughUow,
  sequentialRefreshTokens,
  TTL,
} from './session.test-support.js';

function setup() {
  const credentials = new FakeCredentials();
  credentials.users.set('a@b.co', {
    password: 'pw-correct-horse',
    user: { userId: 'u1', tokenVersion: 4 },
  });
  const sessions = new InMemorySessionRepository();
  const tokens = fakeAccessTokens();
  const orgs = new FakeOrgContexts();
  const useCase = new LoginUseCase(
    credentials,
    sessions,
    sequentialRefreshTokens(),
    tokens.service,
    orgs,
    passthroughUow,
    clockAt(NOW),
    TTL,
  );
  return { sessions, tokens, orgs, useCase };
}

describe('LoginUseCase', () => {
  it('issues access + refresh, saves session with amr pwd and uv', async () => {
    const { sessions, tokens, useCase } = setup();

    const result = await useCase.execute({
      email: 'a@b.co',
      password: 'pw-correct-horse',
      ip: '1.2.3.4',
      userAgent: 'ua',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [session] = [...sessions.rows.values()];
    expect(session?.snapshot).toMatchObject({
      userId: 'u1',
      refreshHash: 'hash:secret-1',
      amr: ['pwd'],
      ip: '1.2.3.4',
    });
    expect(result.value).toEqual({
      accessToken: `access:${session?.id}:4`,
      expiresIn: 600,
      refreshToken: `${session?.id}.secret-1`,
      refreshMaxAgeSeconds: TTL.idleSeconds,
    });
    expect(tokens.issued[0]).toMatchObject({
      sub: 'u1',
      uv: 4,
      amr: ['pwd'],
      authTime: NOW,
    });
  });

  it('invalid credentials pass through, nothing saved', async () => {
    const { sessions, useCase } = setup();

    const result = await useCase.execute({
      email: 'a@b.co',
      password: 'wrong',
      ip: null,
      userAgent: null,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.INVALID_CREDENTIALS' },
    });
    expect(sessions.rows.size).toBe(0);
  });

  it('puts the default org (most recent or only membership) into the token and the session', async () => {
    const { sessions, tokens, orgs, useCase } = setup();
    orgs.defaults.set('u1', ORG_CONTEXT);

    const result = await useCase.execute({
      email: 'a@b.co',
      password: 'pw-correct-horse',
      ip: null,
      userAgent: null,
    });

    expect(result.ok).toBe(true);
    const { mfaRequired: _ignored, ...claims } = ORG_CONTEXT;
    expect(tokens.issued[0]?.org).toEqual(claims);
    expect([...sessions.rows.values()][0]?.snapshot.activeOrgId).toBe('org-1');
  });

  it('skips a default org that requires MFA when the login used only a password', async () => {
    const { tokens, orgs, useCase } = setup();
    orgs.defaults.set('u1', { ...ORG_CONTEXT, mfaRequired: true });

    await useCase.execute({
      email: 'a@b.co',
      password: 'pw-correct-horse',
      ip: null,
      userAgent: null,
    });

    expect(tokens.issued[0]?.org).toBeUndefined();
  });
});
