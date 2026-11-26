import type { Redis } from 'ioredis';
import { ok } from '../../src/shared/domain/result.js';
import { RedisLoginAttemptCounter } from '../../src/modules/identity/infrastructure/redis-login-attempt-counter.js';
import type { UserId } from '../../src/modules/identity/domain/user.js';
import { createTestRedis, uniqueKey } from './support/redis.js';

describe('RedisLoginAttemptCounter (integration)', () => {
  let redis: Redis;
  let counter: RedisLoginAttemptCounter;

  beforeAll(async () => {
    redis = createTestRedis();
    await redis.connect();
    counter = new RedisLoginAttemptCounter(redis);
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('increments per user and expires', async () => {
    const user = uniqueKey('u') as UserId;

    expect(await counter.registerFailure(user)).toEqual(ok(1));
    expect(await counter.registerFailure(user)).toEqual(ok(2));
    const ttl = await redis.ttl(`login:fail:${user}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(900);
  });

  it('reset clears', async () => {
    const user = uniqueKey('u') as UserId;
    await counter.registerFailure(user);

    await counter.reset(user);

    expect(await counter.registerFailure(user)).toEqual(ok(1));
  });

  it('maps an unreachable Redis to ServiceBusyError instead of throwing', async () => {
    const offline = createTestRedis('redis://127.0.0.1:1/0');
    const degraded = new RedisLoginAttemptCounter(offline);
    const user = uniqueKey('u') as UserId;

    expect(await degraded.registerFailure(user)).toMatchObject({
      ok: false,
      error: { code: 'COMMON.SERVICE_UNAVAILABLE' },
    });
    expect(await degraded.reset(user)).toMatchObject({ ok: false });
    offline.disconnect();
  });
});
