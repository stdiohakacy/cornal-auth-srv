import { OutboxRelay } from '@nestjs/outbox';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { IdentityHttpModule } from '../../src/modules/identity/identity-http.module.js';
import { IdentityWorkerModule } from '../../src/modules/identity/identity-worker.module.js';
import { SessionHttpModule } from '../../src/modules/session/session-http.module.js';
import { SessionWorkerModule } from '../../src/modules/session/session-worker.module.js';
import { createTestApp } from './support/create-app.js';

let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `100.64.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};
const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'a-brand-new-passphrase';

type Device = { tokens: { accessToken: string }; cookie: string };

describe('/iam/me (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp(
      { APP_ROLE: 'api' },
      {
        imports: [
          IdentityHttpModule,
          SessionHttpModule,
          IdentityWorkerModule,
          SessionWorkerModule,
        ],
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  async function registeredEmail(): Promise<string> {
    const email = `me-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
    await http()
      .post('/auth/register')
      .set('x-forwarded-for', nextIp())
      .send({ email, password: PASSWORD })
      .expect(202);
    return email;
  }
  async function login(
    email: string,
    userAgent = 'Device/1.0',
    password = PASSWORD,
  ): Promise<Device> {
    const res = await http()
      .post('/auth/login')
      .set('x-forwarded-for', nextIp())
      .set('user-agent', userAgent)
      .send({ email, password })
      .expect(200);
    const setCookie = (res.headers['set-cookie'] as unknown as string[]).find(
      (c) => c.startsWith('cornal_rt='),
    );
    return { tokens: res.body, cookie: setCookie?.split(';')[0] ?? '' };
  }
  const bearer = (device: Device) => `Bearer ${device.tokens.accessToken}`;
  const refreshStatus = async (device: Device) =>
    (
      await http()
        .post('/auth/refresh')
        .set('x-forwarded-for', nextIp())
        .set('cookie', device.cookie)
        .send()
    ).status;
  const listDevices = async (device: Device) =>
    (
      await http()
        .get('/iam/me/sessions')
        .set('authorization', bearer(device))
        .expect(200)
    ).body.sessions as {
      id: string;
      current: boolean;
      ip: string;
      userAgent: string;
    }[];
  const sessionIdOf = async (device: Device) =>
    (await listDevices(device)).find((s) => s.current)?.id ?? '';

  it('lists two devices after two logins, flags the current one, shows ip and user agent', async () => {
    const email = await registeredEmail();
    await login(email, 'Laptop/1.0');
    const phone = await login(email, 'Phone/2.0');

    const devices = await listDevices(phone);

    expect(devices).toHaveLength(2);
    expect(devices.filter((d) => d.current)).toEqual([
      expect.objectContaining({ userAgent: 'Phone/2.0' }),
    ]);
    expect(devices.map((d) => d.userAgent).sort()).toEqual([
      'Laptop/1.0',
      'Phone/2.0',
    ]);
    expect(devices[0]?.ip).toMatch(/^100\.64\./);
  });

  it('revoke one own device → its refresh fails, the current still works', async () => {
    const email = await registeredEmail();
    const laptop = await login(email, 'Laptop/1.0');
    const phone = await login(email, 'Phone/2.0');

    await http()
      .delete(`/iam/me/sessions/${await sessionIdOf(laptop)}`)
      .set('authorization', bearer(phone))
      .expect(204);

    expect(await refreshStatus(laptop)).toBe(401);
    expect(await refreshStatus(phone)).toBe(200);
  });

  it("revoking someone else's session id → 404 SESSION.NOT_FOUND, theirs still works", async () => {
    const victim = await login(await registeredEmail());
    const attacker = await login(await registeredEmail());

    const res = await http()
      .delete(`/iam/me/sessions/${await sessionIdOf(victim)}`)
      .set('authorization', bearer(attacker));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SESSION.NOT_FOUND');
    expect(await refreshStatus(victim)).toBe(200);
  });

  it('sign out other devices keeps the current one', async () => {
    const email = await registeredEmail();
    const a = await login(email, 'A/1');
    const b = await login(email, 'B/1');
    const current = await login(email, 'C/1');

    await http()
      .delete('/iam/me/sessions')
      .set('authorization', bearer(current))
      .expect(204);

    expect([
      await refreshStatus(a),
      await refreshStatus(b),
      await refreshStatus(current),
    ]).toEqual([401, 401, 200]);
  });

  it('change password: wrong current → 401; correct → 204, old password rejected at login, new accepted', async () => {
    const email = await registeredEmail();
    const device = await login(email);
    const change = (currentPassword: string) =>
      http()
        .post('/iam/me/password')
        .set('x-forwarded-for', nextIp())
        .set('authorization', bearer(device))
        .send({ currentPassword, newPassword: NEW_PASSWORD });

    const wrong = await change('wrong-password-x');
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('IDENTITY.INVALID_CREDENTIALS');

    await change(PASSWORD).expect(204);

    const oldLogin = await http()
      .post('/auth/login')
      .set('x-forwarded-for', nextIp())
      .send({ email, password: PASSWORD });
    expect(oldLogin.status).toBe(401);
    await login(email, 'New/1', NEW_PASSWORD);
  });

  it('after change password and relay, every refresh token of the user (including the current session) is rejected', async () => {
    const email = await registeredEmail();
    const other = await login(email, 'Other/1');
    const device = await login(email, 'Current/1');

    await http()
      .post('/iam/me/password')
      .set('x-forwarded-for', nextIp())
      .set('authorization', bearer(device))
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(204);
    await app.get(OutboxRelay).runOnce();

    expect([await refreshStatus(other), await refreshStatus(device)]).toEqual([
      401, 401,
    ]);
  });

  it('all /iam/me routes require a bearer token → 401', async () => {
    const statuses = await Promise.all([
      http().get('/iam/me/sessions'),
      http().delete('/iam/me/sessions'),
      http().delete('/iam/me/sessions/01a21877-9b5a-7147-b111-fa795f1f2ee1'),
      http()
        .post('/iam/me/password')
        .send({ currentPassword: 'x', newPassword: 'y' }),
    ]);

    expect(statuses.map((r) => r.status)).toEqual([401, 401, 401, 401]);
  });
});
