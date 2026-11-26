import { OutboxRelay } from '@nestjs/outbox';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  EMAIL_SENDER,
  type EmailMessage,
} from '../../src/modules/identity/application/ports.js';
import { RegisterUserUseCase } from '../../src/modules/identity/application/register-user.use-case.js';
import { IdentityWorkerModule } from '../../src/modules/identity/identity-worker.module.js';
import { ClockModule } from '../../src/shared/infrastructure/clock.module.js';
import { RedisModule } from '../../src/shared/infrastructure/redis/redis.module.js';
import { createPersistenceApp } from './support/persistence-app.js';

describe('email-verification consumer (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  const sent: EmailMessage[] = [];
  let failNext = false;

  beforeAll(async () => {
    moduleRef = await createPersistenceApp({
      imports: [ClockModule, RedisModule, IdentityWorkerModule],
      providers: [
        {
          token: EMAIL_SENDER,
          value: {
            send: async (message: EmailMessage) => {
              if (failNext) {
                failNext = false;
                throw new Error('smtp unavailable');
              }
              sent.push(message);
            },
          },
        },
      ],
    });
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('send failure → no token row committed, message retried; next run sends once and leaves exactly one open token', async () => {
    await dataSource.query('DELETE FROM nest_outbox.messages');
    const email = `consumer-${Date.now()}@test.local`;
    const registered = await moduleRef
      .get(RegisterUserUseCase)
      .execute({ email, password: 'correct-horse-battery' });
    if (!registered.ok) throw registered.error;
    const [{ id: userId }]: [{ id: string }] = await dataSource.query(
      'SELECT id FROM users WHERE email = $1',
      [email],
    );
    const openTokens = async () =>
      Number(
        (
          await dataSource.query(
            `SELECT count(*)::int AS n FROM one_time_tokens WHERE user_id = $1 AND consumed_at IS NULL`,
            [userId],
          )
        )[0].n,
      );
    const relay = moduleRef.get(OutboxRelay);

    failNext = true;
    await relay.runOnce();

    expect(sent).toHaveLength(0);
    expect(await openTokens()).toBe(0);
    const [pending]: { attempts: number }[] = await dataSource.query(
      `SELECT attempts FROM nest_outbox.messages WHERE topic = 'identity.user.registered'`,
    );
    expect(pending?.attempts).toBe(1);

    await dataSource.query('UPDATE nest_outbox.messages SET available_at = 0');
    await relay.runOnce();

    expect(sent.filter((m) => m.to === email)).toHaveLength(1);
    expect(await openTokens()).toBe(1);
  });
});
