import { resolveHashConcurrency } from './hash-concurrency.js';

describe('resolveHashConcurrency', () => {
  it('defaults to the libuv threadpool size (4) even on many CPUs', () => {
    expect(
      resolveHashConcurrency(
        { HASH_MAX_CONCURRENCY: undefined, UV_THREADPOOL_SIZE: undefined },
        10,
      ),
    ).toBe(4);
  });

  it('follows UV_THREADPOOL_SIZE when it is raised, capped by CPUs', () => {
    expect(
      resolveHashConcurrency(
        { HASH_MAX_CONCURRENCY: undefined, UV_THREADPOOL_SIZE: 16 },
        10,
      ),
    ).toBe(10);
    expect(
      resolveHashConcurrency(
        { HASH_MAX_CONCURRENCY: undefined, UV_THREADPOOL_SIZE: 8 },
        10,
      ),
    ).toBe(8);
  });

  it('never exceeds the threadpool, even when HASH_MAX_CONCURRENCY asks for more', () => {
    expect(
      resolveHashConcurrency(
        { HASH_MAX_CONCURRENCY: 32, UV_THREADPOOL_SIZE: 4 },
        10,
      ),
    ).toBe(4);
    expect(
      resolveHashConcurrency(
        { HASH_MAX_CONCURRENCY: 2, UV_THREADPOOL_SIZE: 8 },
        10,
      ),
    ).toBe(2);
  });
});
