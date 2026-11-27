import type { NestExpressApplication } from '@nestjs/platform-express';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import request from 'supertest';
import { CLOCK, type Clock } from '../../src/shared/application/ports.js';
import { createTestApp } from './support/create-app.js';

let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `192.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};
const PASSWORD = 'correct-horse-battery';

/** Wall clock with a movable offset, to step past the 10 s rotation grace window. */
const clock: Clock & { offsetMs: number } = {
  offsetMs: 0,
  now() {
    return new Date(Date.now() + this.offsetMs);
  },
};

const cookieOf = (res: request.Response): string | undefined => {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith('cornal_rt='));
};
const cookieValue = (setCookie: string | undefined) =>
  setCookie?.split(';')[0] ?? '';

describe('session (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp(
      { APP_ROLE: 'login' },
      { providers: [{ token: CLOCK, value: clock }] },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    clock.offsetMs = 0;
  });

  const http = () => request(app.getHttpServer());
  async function registeredEmail(): Promise<string> {
    const email = `session-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
    await http()
      .post('/auth/register')
      .set('x-forwarded-for', nextIp())
      .send({ email, password: PASSWORD })
      .expect(202);
    return email;
  }
  const login = (email: string, password = PASSWORD, mobile = false) => {
    const req = http().post('/auth/login').set('x-forwarded-for', nextIp());
    if (mobile) req.set('x-client-type', 'mobile');
    return req.send({ email, password });
  };
  const refreshWithCookie = (cookie: string) =>
    http()
      .post('/auth/refresh')
      .set('x-forwarded-for', nextIp())
      .set('cookie', cookie)
      .send();

  it('login → 200 with ES256 token whose kid is in the JWKS, HttpOnly SameSite=Strict cookie', async () => {
    const res = await login(await registeredEmail());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 600 });
    expect(res.body.refreshToken).toBeUndefined();
    const setCookie = cookieOf(res);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/Path=\/auth/);

    const jwks = await http().get('/.well-known/jwks.json').expect(200);
    expect(jwks.headers['cache-control']).toContain('max-age=300');
    expect(jwks.body.keys.map((k: { kid: string }) => k.kid)).toContain(
      decodeProtectedHeader(res.body.accessToken).kid,
    );
    const { payload } = await jwtVerify(
      res.body.accessToken,
      createLocalJWKSet(jwks.body),
      { algorithms: ['ES256'] },
    );
    expect(payload).toMatchObject({ amr: ['pwd'], uv: 0 });
  });

  it('wrong password → 401 IDENTITY.INVALID_CREDENTIALS', async () => {
    const res = await login(await registeredEmail(), 'wrong-password-x');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('IDENTITY.INVALID_CREDENTIALS');
  });

  it('GET /auth/session with the access token → 200; without → 401 SESSION.INVALID', async () => {
    const { body } = await login(await registeredEmail()).expect(200);

    const ok = await http()
      .get('/auth/session')
      .set('authorization', `Bearer ${body.accessToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      amr: ['pwd'],
      sessionId: expect.any(String),
      userId: expect.any(String),
    });

    const missing = await http().get('/auth/session');
    expect(missing.status).toBe(401);
    expect(missing.body.code).toBe('SESSION.INVALID');
    expect(missing.headers['www-authenticate']).toContain('Bearer');

    const tampered = await http()
      .get('/auth/session')
      .set('authorization', `Bearer ${body.accessToken}x`);
    expect(tampered.status).toBe(401);
  });

  it('refresh with cookie rotates; the previous cookie is then rejected', async () => {
    const first = cookieValue(
      cookieOf(await login(await registeredEmail()).expect(200)),
    );

    const rotated = await refreshWithCookie(first);
    expect(rotated.status).toBe(200);
    const second = cookieValue(cookieOf(rotated));
    expect(second).not.toBe(first);

    clock.offsetMs = 60_000;
    expect((await refreshWithCookie(first)).status).toBe(401);
  });

  it('reusing an old refresh token revokes the session: the newest token fails too', async () => {
    const first = cookieValue(
      cookieOf(await login(await registeredEmail()).expect(200)),
    );
    const second = cookieValue(
      cookieOf(await refreshWithCookie(first).expect(200)),
    );

    clock.offsetMs = 60_000;
    expect((await refreshWithCookie(first)).status).toBe(401); // theft detected
    const victim = await refreshWithCookie(second);

    expect(victim.status).toBe(401);
    expect(victim.body.code).toBe('SESSION.INVALID');
  });

  it('concurrent refresh with one token → one 200, one 409', async () => {
    const cookie = cookieValue(
      cookieOf(await login(await registeredEmail()).expect(200)),
    );

    const statuses = (
      await Promise.all([refreshWithCookie(cookie), refreshWithCookie(cookie)])
    )
      .map((r) => r.status)
      .sort((a, b) => a - b);

    expect(statuses).toEqual([200, 409]);
  });

  it('random secret with a valid sid → 401, and the real token still works', async () => {
    const cookie = cookieValue(
      cookieOf(await login(await registeredEmail()).expect(200)),
    );
    const sid = cookie.replace('cornal_rt=', '').split('.')[0];

    expect(
      (await refreshWithCookie(`cornal_rt=${sid}.${'A'.repeat(43)}`)).status,
    ).toBe(401);
    expect((await refreshWithCookie(cookie)).status).toBe(200);
  });

  it('mobile: X-Client-Type mobile gets refreshToken in body and can refresh with it', async () => {
    const res = await login(await registeredEmail(), PASSWORD, true).expect(
      200,
    );
    expect(cookieOf(res)).toBeUndefined();
    expect(res.body.refreshToken).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);

    const refreshed = await http()
      .post('/auth/refresh')
      .set('x-forwarded-for', nextIp())
      .set('x-client-type', 'mobile')
      .send({ refreshToken: res.body.refreshToken });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(res.body.refreshToken);
  });

  it('logout → 204, cookie cleared, refresh → 401', async () => {
    const cookie = cookieValue(
      cookieOf(await login(await registeredEmail()).expect(200)),
    );

    const out = await http()
      .post('/auth/logout')
      .set('x-forwarded-for', nextIp())
      .set('cookie', cookie)
      .send();

    expect(out.status).toBe(204);
    expect(cookieOf(out)).toMatch(/Expires=Thu, 01 Jan 1970/);
    // Browsers only clear a cookie with the same Path it was set with.
    expect(cookieOf(out)).toMatch(/Path=\/auth/);
    expect((await refreshWithCookie(cookie)).status).toBe(401);
  });
});
