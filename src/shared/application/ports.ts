import type { Result } from '../domain/result.js';

/**
 * Generic repository contract. Module ports extend it with intention-revealing finders.
 * Returns `undefined` for "not found" (no Option library, no null).
 */
export interface RepositoryPort<TAggregate, TId extends string> {
  findById(id: TId): Promise<TAggregate | undefined>;
  save(aggregate: TAggregate): Promise<void>;
}

/** Domain <-> persistence translation. `toDomain` must reconstitute (never raise events). */
export interface Mapper<TDomain, TRecord> {
  toDomain(record: TRecord): TDomain;
  toPersistence(domain: TDomain): TRecord;
}

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

/**
 * Runs `work` in one DB transaction. Commits on `ok`, rolls back on `err` or throw.
 * Events of every aggregate saved inside `work` are written to the outbox before COMMIT.
 */
export interface UnitOfWork {
  run<T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>>;
}

export const CLOCK = Symbol('CLOCK');
export interface Clock {
  now(): Date;
}
