import { randomUUIDv7 } from 'node:crypto';
import { Redis } from 'ioredis';
import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    redisUrl: string;
  }
}

/** Redis server for tests; global setup picks and flushes one DB per Vitest project. */
export const TEST_REDIS_SERVER_URL =
  process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379';

/** URL of the Redis DB prepared for the current project by global setup. */
export const testRedisUrl = (): string => inject('redisUrl');

export const createTestRedis = (url = testRedisUrl()): Redis =>
  new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

export const uniqueKey = (label: string): string =>
  `${label}:${randomUUIDv7()}`;
