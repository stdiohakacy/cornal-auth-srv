import type { Redis } from 'ioredis';
import { RedisThrottlerStorage } from '../../src/shared/infrastructure/redis/redis-throttler.storage.js';
import { createTestRedis, uniqueKey } from './support/redis.js';

describe('RedisThrottlerStorage (integration)', () => {
  let redis: Redis;
  let storage: RedisThrottlerStorage;

  beforeAll(async () => {
    redis = createTestRedis();
    await redis.connect();
    storage = new RedisThrottlerStorage(redis);
  });

  afterAll(async () => {
    storage.onModuleDestroy();
    redis.disconnect();
  });

  it('counts hits within ttl and reports timeToExpire', async () => {
    const key = uniqueKey('count');

    await storage.increment(key, 10_000, 5, 0, 'ip');
    const second = await storage.increment(key, 10_000, 5, 0, 'ip');

    expect(second.totalHits).toBe(2);
    expect(second.isBlocked).toBe(false);
    expect(second.timeToExpire).toBeGreaterThan(0);
    expect(second.timeToExpire).toBeLessThanOrEqual(10);
  });

  it('blocks after limit for blockDuration', async () => {
    const key = uniqueKey('block');

    for (let i = 0; i < 3; i += 1)
      await storage.increment(key, 10_000, 3, 0, 'ip');
    const over = await storage.increment(key, 10_000, 3, 30_000, 'ip');
    const after = await storage.increment(key, 10_000, 3, 30_000, 'ip');

    expect(over.isBlocked).toBe(true);
    expect(after.isBlocked).toBe(true);
    expect(after.timeToBlockExpire).toBeGreaterThan(10);
  });

  it('separate throttler names do not share counters', async () => {
    const key = uniqueKey('names');

    await storage.increment(key, 10_000, 5, 0, 'ip');
    const other = await storage.increment(key, 10_000, 5, 0, 'email');

    expect(other.totalHits).toBe(1);
  });

  it('falls back to in-memory counting at half the limit when Redis is unreachable', async () => {
    const offline = createTestRedis('redis://127.0.0.1:1/0');
    const degraded = new RedisThrottlerStorage(offline);
    const key = uniqueKey('offline');

    const first = await degraded.increment(key, 10_000, 4, 0, 'ip');
    const second = await degraded.increment(key, 10_000, 4, 0, 'ip');
    const third = await degraded.increment(key, 10_000, 4, 0, 'ip');

    expect([first.isBlocked, second.isBlocked, third.isBlocked]).toEqual([
      false,
      false,
      true,
    ]);
    degraded.onModuleDestroy();
    offline.disconnect();
  });
});
