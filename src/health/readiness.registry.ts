import { Injectable } from '@nestjs/common';

/** Resolves `true` when the dependency can serve traffic. Must honour `signal` (aborted on timeout). */
export type ReadinessProbe = (signal: AbortSignal) => Promise<boolean>;

/**
 * Adapters (PostgreSQL, Redis, NATS, ...) register their probe on module init, so `/health/ready`
 * grows with the app without the health module importing any adapter.
 */
@Injectable()
export class ReadinessRegistry {
  readonly #probes = new Map<string, ReadinessProbe>();

  register(name: string, probe: ReadinessProbe): void {
    if (this.#probes.has(name)) {
      throw new Error(`Readiness probe "${name}" is already registered`);
    }
    this.#probes.set(name, probe);
  }

  entries(): ReadonlyMap<string, ReadinessProbe> {
    return this.#probes;
  }
}
