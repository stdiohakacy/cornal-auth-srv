/**
 * Bounds concurrent Argon2 work per pod. Without it, a login burst queues hundreds of jobs on the
 * libuv threadpool, every request's latency grows together and p99 explodes. With it, excess
 * requests fail fast with 503 + Retry-After and the load balancer sends them elsewhere.
 */
export class HashAdmissionGate {
  #running = 0;
  readonly #waiters: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number,
  ) {}

  get stats(): { running: number; queued: number } {
    return { running: this.#running, queued: this.#waiters.length };
  }

  /** Returns `undefined` when the pod is saturated: map it to 503 + Retry-After. */
  async run<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (this.#running >= this.maxConcurrent) {
      if (this.#waiters.length >= this.maxQueued) return undefined;
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    }
    this.#running += 1;
    try {
      return await work();
    } finally {
      this.#running -= 1;
      this.#waiters.shift()?.();
    }
  }
}
