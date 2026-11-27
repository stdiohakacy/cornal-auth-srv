import { Injectable } from '@nestjs/common';
import { Outbox } from '@nestjs/outbox';
import { DataSource, type EntityManager } from 'typeorm';
import type { UnitOfWork } from '../../application/ports.js';
import type { Err, Result } from '../../domain/result.js';
import { RequestContext } from '../request-context/request-context.js';
import { OutboxTopics } from './outbox-topics.js';
import { TransactionContext } from './transaction-context.js';

/** Thrown inside the transaction callback only to make TypeORM roll back; never escapes `run`. */
class RollbackSignal extends Error {
  constructor() {
    super('Unit of work rolled back by an err() result');
    this.name = 'RollbackSignal';
  }
}

@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tx: TransactionContext,
    private readonly outbox: Outbox<EntityManager>,
    private readonly request: RequestContext,
    private readonly topics: OutboxTopics,
  ) {}

  async run<T, E>(work: () => Promise<Result<T, E>>): Promise<Result<T, E>> {
    // Propagation REQUIRED: a nested run joins the outer transaction, which decides the outcome.
    if (this.tx.active) return work();

    let failure: Err<E> | undefined;
    try {
      const result = await this.dataSource.transaction((manager) =>
        this.tx.run(manager, async () => {
          const outcome = await work();
          if (!outcome.ok) {
            failure = outcome;
            throw new RollbackSignal();
          }
          await this.flushEvents(manager);
          return outcome;
        }),
      );
      this.outbox.notify();
      return result;
    } catch (error) {
      if (error instanceof RollbackSignal && failure !== undefined)
        return failure;
      throw error;
    }
  }

  /** Writes the tracked aggregates' published events to the outbox inside the same transaction. */
  private async flushEvents(manager: EntityManager): Promise<void> {
    const events = [...(this.tx.active?.tracked ?? [])]
      .flatMap((aggregate) => aggregate.pullEvents())
      .filter((event) => this.topics.isPublished(event.type));
    if (events.length === 0) return;
    const meta = this.request.current();
    await this.outbox.add(
      manager,
      events.map((event) => ({
        id: event.id,
        topic: event.type,
        key: event.aggregateId,
        payload: event,
        headers: {
          ...(meta ? { 'x-request-id': meta.requestId } : {}),
          ...(meta?.actorId ? { 'x-actor-id': meta.actorId } : {}),
        },
      })),
    );
  }
}
