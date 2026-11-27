import { OutboxRelay } from '@nestjs/outbox';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  EMAIL_SENDER,
  type EmailMessage,
} from '../../src/modules/identity/application/ports.js';
import { IdentityWorkerModule } from '../../src/modules/identity/identity-worker.module.js';
import { createTestApp } from './support/create-app.js';

let ipCounter = 0;
/** A fresh client IP per test, so rate-limit windows never leak between tests. */
const nextIp = () => {
  ipCounter += 1;
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};
const uniqueEmail = () =>
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
const PASSWORD = 'correct-horse-battery';
const ACCEPTED = { status: 'accepted' };

describe('identity (e2e)', () => {
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
        ],
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const register = (email: string, ip = nextIp(), password = PASSWORD) =>
    request(app.getHttpServer())
      .post('/auth/register')
      .set('x-forwarded-for', ip)
      .send({ email, password });
  const usersWithEmail = async (
    email: string,
  ): Promise<{ id: string; email_verified_at: Date | null }[]> =>
    app
      .get(DataSource)
      .query('SELECT id, email_verified_at FROM users WHERE email = $1', [
        email,
      ]);
  const deliver = async () => {
    sent.length = 0;
    await app.get(OutboxRelay).runOnce();
  };

  it('register → 202 accepted; user row exists, unverified', async () => {
    const email = uniqueEmail();

    const res = await register(email);

    expect(res.status).toBe(202);
    expect(res.body).toEqual(ACCEPTED);
    expect(await usersWithEmail(email)).toEqual([
      { id: expect.any(String), email_verified_at: null },
    ]);
  });

  it('existing email (different case) → the same 202 body; the owner gets an account-exists email', async () => {
    const email = uniqueEmail();
    await register(email).expect(202);
    await deliver();

    const res = await register(email.toUpperCase());
    await deliver();

    expect(res.status).toBe(202);
    expect(res.body).toEqual(ACCEPTED);
    expect(await usersWithEmail(email)).toHaveLength(1);
    expect(sent.filter((m) => m.to === email)).toEqual([
      {
        to: email,
        template: 'account-exists',
        data: { link: 'http://localhost:3000/login' },
      },
    ]);
  });

  it('weak password → 422 IDENTITY.WEAK_PASSWORD', async () => {
    const res = await register(uniqueEmail(), nextIp(), 'short');

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IDENTITY.WEAK_PASSWORD');
  });

  it('full verification flow, then reusing the token → 400 IDENTITY.INVALID_TOKEN', async () => {
    const email = uniqueEmail();
    await register(email).expect(202);

    await deliver();

    const message = sent.find((m) => m.to === email);
    expect(message?.template).toBe('verify-email');
    const token = new URL(message?.data.link ?? 'http://x').searchParams.get(
      'token',
    );
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const verify = () =>
      request(app.getHttpServer())
        .post('/auth/verify-email')
        .set('x-forwarded-for', nextIp())
        .send({ token });
    await verify().expect(204);
    expect((await usersWithEmail(email))[0]?.email_verified_at).toBeInstanceOf(
      Date,
    );

    const reused = await verify();
    expect(reused.status).toBe(400);
    expect(reused.body.code).toBe('IDENTITY.INVALID_TOKEN');
  });

  it('11th register from one IP within the window → 429 COMMON.RATE_LIMITED with Retry-After', async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i += 1) {
      const res = await register(uniqueEmail(), ip);
      expect(res.status).not.toBe(429);
    }

    const blocked = await register(uniqueEmail(), ip);

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('COMMON.RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('concurrent registrations of the same email → both 202, exactly one account', async () => {
    const email = uniqueEmail();

    const responses = await Promise.all([register(email), register(email)]);

    expect(responses.map((r) => r.status)).toEqual([202, 202]);
    expect(await usersWithEmail(email)).toHaveLength(1);
  });
});
