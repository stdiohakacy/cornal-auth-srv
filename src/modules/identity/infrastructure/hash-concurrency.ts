import type { AppConfig } from '../../../config/env.schema.js';

/** libuv's default when UV_THREADPOOL_SIZE is unset. */
const DEFAULT_THREADPOOL_SIZE = 4;

/**
 * Concurrent Argon2 jobs admitted per pod. Async crypto runs on the libuv threadpool, so admitting
 * more jobs than threads only builds a hidden queue (latency grows, nothing gets faster). Bounded by
 * the threadpool, the CPU count and the explicit HASH_MAX_CONCURRENCY, whichever is smallest.
 */
export function resolveHashConcurrency(
  config: Pick<AppConfig, 'HASH_MAX_CONCURRENCY' | 'UV_THREADPOOL_SIZE'>,
  cpus: number,
): number {
  const threads = config.UV_THREADPOOL_SIZE ?? DEFAULT_THREADPOOL_SIZE;
  return Math.max(
    1,
    Math.min(
      threads,
      cpus,
      config.HASH_MAX_CONCURRENCY ?? Number.POSITIVE_INFINITY,
    ),
  );
}
