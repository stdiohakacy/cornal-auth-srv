import { Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  type ThrottlerStorage,
  ThrottlerStorageService,
} from '@nestjs/throttler';
import type { Redis } from 'ioredis';

/**
 * Atomic fixed-window counter with an optional block key. Returns
 * [hits, windowTtlMs, blocked (0|1), blockTtlMs].
 */
const INCREMENT_SCRIPT = `
local hitsKey, blockKey = KEYS[1], KEYS[2]
local ttl, limit, block = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', hitsKey) or '0')
  return {hits, redis.call('PTTL', hitsKey), 1, blockTtl}
end
local hits = redis.call('INCR', hitsKey)
if hits == 1 then redis.call('PEXPIRE', hitsKey, ttl) end
local windowTtl = redis.call('PTTL', hitsKey)
if hits > limit then
  if block > 0 then
    redis.call('SET', blockKey, '1', 'PX', block)
    return {hits, windowTtl, 1, block}
  end
  return {hits, windowTtl, 1, windowTtl}
end
return {hits, windowTtl, 0, 0}
`;

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

const DEGRADED_WARNING_INTERVAL_MS = 60_000;

const toSeconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

function parseReply(reply: unknown): [number, number, number, number] {
  if (Array.isArray(reply) && reply.length === 4) {
    const [hits, windowTtl, blocked, blockTtl]: unknown[] = reply;
    if (
      typeof hits === 'number' &&
      typeof windowTtl === 'number' &&
      typeof blocked === 'number' &&
      typeof blockTtl === 'number'
    ) {
      return [hits, windowTtl, blocked, blockTtl];
    }
  }
  throw new Error(
    `Unexpected throttler script reply: ${JSON.stringify(reply)}`,
  );
}

/**
 * Shared rate-limit counters in Redis. When Redis is unreachable it degrades to per-pod
 * in-memory counters at HALF the limit: never fail-open, and stricter while blind.
 */
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  readonly #logger = new Logger(RedisThrottlerStorage.name);
  readonly #fallback = new ThrottlerStorageService();
  #lastWarningAt = 0;

  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `thr:${throttlerName}:${key}`;
    try {
      const [hits, windowTtl, blocked, blockTtl] = parseReply(
        await this.redis.eval(
          INCREMENT_SCRIPT,
          2,
          hitsKey,
          `${hitsKey}:block`,
          ttl,
          limit,
          blockDuration,
        ),
      );
      return {
        totalHits: hits,
        timeToExpire: toSeconds(windowTtl),
        isBlocked: blocked === 1,
        timeToBlockExpire: toSeconds(blockTtl),
      };
    } catch (error) {
      this.#warnDegraded(error);
      return this.#fallback.increment(
        hitsKey,
        ttl,
        Math.max(1, Math.ceil(limit / 2)),
        blockDuration,
        throttlerName,
      );
    }
  }

  onModuleDestroy(): void {
    this.#fallback.onApplicationShutdown();
  }

  #warnDegraded(error: unknown): void {
    const now = Date.now();
    if (now - this.#lastWarningAt < DEGRADED_WARNING_INTERVAL_MS) return;
    this.#lastWarningAt = now;
    this.#logger.warn(
      `Redis unavailable, rate limiting per pod at half limits: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
