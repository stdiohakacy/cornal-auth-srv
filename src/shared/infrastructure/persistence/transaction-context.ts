import { AsyncLocalStorage } from 'node:async_hooks';
import type { EntityManager } from 'typeorm';
import type { EventSource } from '../../domain/aggregate-root.js';
import { InvariantViolation } from '../../domain/domain-error.js';

type TransactionStore = {
  readonly manager: EntityManager;
  readonly tracked: Set<EventSource>;
};

/** Native ALS. No `nestjs-cls`, no `cls-hooked`. One instance per app (plain singleton provider). */
export class TransactionContext {
  readonly #storage = new AsyncLocalStorage<TransactionStore>();

  run<T>(manager: EntityManager, fn: () => Promise<T>): Promise<T> {
    return this.#storage.run({ manager, tracked: new Set() }, fn);
  }

  get active(): TransactionStore | undefined {
    return this.#storage.getStore();
  }

  /** Writes must go through UnitOfWork.run(). Reads may fall back to the default manager. */
  requireManager(): EntityManager {
    return this.#require().manager;
  }

  track(aggregate: EventSource): void {
    this.#require().tracked.add(aggregate);
  }

  #require(): TransactionStore {
    const store = this.#storage.getStore();
    if (store === undefined)
      throw new InvariantViolation('Database write outside UnitOfWork.run()');
    return store;
  }
}
