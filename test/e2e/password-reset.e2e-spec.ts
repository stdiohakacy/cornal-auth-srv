import { OutboxRelay } from '@nestjs/outbox';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  BREACHED_PASSWORD_CHECKER,
  EMAIL_SENDER,
  type EmailMessage,
} from '../../src/modules/identity/application/ports.js';
import { VerifyCredentialsUseCase } from '../../src/modules/identity/application/verify-credentials.use-case.js';
import { IdentityWorkerModule } from '../../src/modules/identity/identity-worker.module.js';
import { createTestApp } from './support/create-app.js';

let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `203.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};
const uniqueEmail = () =>
  `reset-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
const OLD_PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'a-brand-new-passphrase';
const BREACHED_PASSWORD = 'breached-passphrase-123';

describe('password reset (e2e)', () => {
  let app: NestExpressApplication;
  const sent: EmailMessage[] = [];

  beforeAll(async () => {
    app = await createTestApp(
      { APP_ROLE: 'login' },
      {
        imports: [IdentityWorkerModule],
        providers: [
          {
            token: EMAIL_SENDER,
            value: { send: async (m: EmailMessage) => void sent.push(m) },
          },
          {
            token: BREACHED_PASSWORD_CHECKER,
            value: { isBreached: async (p: string) => p === BREACHED_PASSWORD },
          },
        ],
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string, body: object) =>
    request(app.getHttpServer())
      .post(path)
      .set('x-forwarded-for', nextIp())
      .send(body);
  const deliver = async () => {
    sent.length = 0;
    await app.get(OutboxRelay).runOnce();
  };
  const registered = async () => {
    const email = uniqueEmail();
    await post('/auth/register', { email, password: OLD_PASSWORD }).expect(202);
    await deliver();
    return email;
  };
  const resetTokenFor = async (email: string) => {
    await post('/auth/password/forgot', { email }).expect(202);
    await deliver();
    const mail = sent.find(
      (m) => m.to === email && m.template === 'password-reset',
    );
    return (
      new URL(mail?.data.link ?? 'http://x').searchParams.get('token') ?? ''
    );
  };
  const credentialsOk = async (email: string, password: string) =>
    (await app.get(VerifyCredentialsUseCase).execute({ email, password })).ok;

  it('forgot with unknown email → 202 accepted, no email after relay', async () => {
    const email = uniqueEmail();
    const res = await post('/auth/password/forgot', { email });
    await deliver();

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'accepted' });
    // Other files may leave undelivered messages in the shared e2e outbox: filter by recipient.
    expect(sent.filter((m) => m.to === email)).toEqual([]);
  });

  it('full reset: link → 204 → old password rejected, new accepted → password-changed email', async () => {
    const email = await registered();
    const token = await resetTokenFor(email);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await post('/auth/password/reset', {
      token,
      password: NEW_PASSWORD,
    }).expect(204);
    await deliver();

    expect(await credentialsOk(email, OLD_PASSWORD)).toBe(false);
    expect(await credentialsOk(email, NEW_PASSWORD)).toBe(true);
    expect(sent.map((m) => m.template)).toContain('password-changed');
  });

  it('reusing the reset token → 400 IDENTITY.INVALID_TOKEN', async () => {
    const email = await registered();
    const token = await resetTokenFor(email);
    await post('/auth/password/reset', {
      token,
      password: NEW_PASSWORD,
    }).expect(204);

    const reused = await post('/auth/password/reset', {
      token,
      password: 'yet-another-passphrase',
    });

    expect(reused.status).toBe(400);
    expect(reused.body.code).toBe('IDENTITY.INVALID_TOKEN');
  });

  it('breached new password → 422 IDENTITY.PASSWORD_BREACHED (token still usable)', async () => {
    const email = await registered();
    const token = await resetTokenFor(email);

    const res = await post('/auth/password/reset', {
      token,
      password: BREACHED_PASSWORD,
    });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IDENTITY.PASSWORD_BREACHED');
    await post('/auth/password/reset', {
      token,
      password: NEW_PASSWORD,
    }).expect(204);
  });

  it('4th forgot for the same email within the hour → 429', async () => {
    const email = uniqueEmail();
    for (let i = 0; i < 3; i += 1)
      await post('/auth/password/forgot', { email }).expect(202);

    const blocked = await post('/auth/password/forgot', { email });

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('COMMON.RATE_LIMITED');
  });
});
