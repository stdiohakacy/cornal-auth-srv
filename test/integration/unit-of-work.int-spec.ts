import { randomUUIDv7 } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../src/shared/application/ports.js';
import { AggregateRoot } from '../../src/shared/domain/aggregate-root.js';
import { InvariantViolation } from '../../src/shared/domain/domain-error.js';
import {
  createEvent,
  type DomainEvent,
} from '../../src/shared/domain/domain-event.js';
import { err, ok } from '../../src/shared/domain/result.js';
import { ConcurrencyConflictError } from '../../src/shared/infrastructure/persistence/concurrency-conflict.error.js';
import { TransactionContext } from '../../src/shared/infrastructure/persistence/transaction-context.js';
import { RequestContext } from '../../src/shared/infrastructure/request-context/request-context.js';
import { createPersistenceApp } from './support/persistence-app.js';

type CounterEvent = DomainEvent<'test.counter.incremented', { by: number }>;

class Counter extends AggregateRoot<string, { value: number }, CounterEvent> {
  static create(id: string): Counter {
    return new Counter(id, { value: 0 }, 0);
  }
  static reconstitute(id: string, value: number, version: number): Counter {
    return new Counter(id, { value }, version);
  }
  get value(): number {
    return this.props.value;
  }
  increment(by: number): void {
    this.props.value += by;
    this.raise(
      createEvent({
        type: 'test.counter.incremented',
        aggregateType: 'Counter',
        aggregateId: this.id,
        payload: { by },
      }),
    );
  }
}

/** Minimal repository following the production contract: requireManager → conditional write → track. */
class CounterRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tx: TransactionContext,
  ) {}

  async findById(id: string): Promise<Counter | undefined> {
    const manager = this.tx.active?.manager ?? this.dataSource.manager;
    const [row]: { value: number; version: number }[] = await manager.query(
      'SELECT value, version FROM it_counters WHERE id = $1',
      [id],
    );
    return row ? Counter.reconstitute(id, row.value, row.version) : undefined;
  }

  async save(counter: Counter): Promise<void> {
    const manager = this.tx.requireManager();
    if (counter.version === 0) {
      await manager.query(
        'INSERT INTO it_counters (id, value, version) VALUES ($1, $2, 1)',
        [counter.id, counter.value],
      );
    } else {
      const [, affected]: [unknown, number] = await manager.query(
        'UPDATE it_counters SET value = $2, version = version + 1 WHERE id = $1 AND version = $3',
        [counter.id, counter.value, counter.version],
      );
      if (affected !== 1)
        throw new ConcurrencyConflictError('Counter', counter.id);
    }
    counter.markPersisted();
    this.tx.track(counter);
  }
}

describe('TypeOrmUnitOfWork (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let uow: UnitOfWork;
  let repo: CounterRepository;

  const rows = async () =>
    Number(
      (await dataSource.query('SELECT count(*)::int AS n FROM it_counters'))[0]
        .n,
    );
  const messages = async (): Promise<
    { topic: string; key: string; headers: Record<string, string> }[]
  > =>
    dataSource.query(
      'SELECT topic, key, headers FROM nest_outbox.messages ORDER BY seq',
    );

  beforeAll(async () => {
    moduleRef = await createPersistenceApp();
    dataSource = moduleRef.get(DataSource);
    uow = moduleRef.get<UnitOfWork>(UNIT_OF_WORK);
    repo = new CounterRepository(dataSource, moduleRef.get(TransactionContext));
    await dataSource.query(
      'CREATE TABLE IF NOT EXISTS it_counters (id uuid PRIMARY KEY, value int NOT NULL, version int NOT NULL)',
    );
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE it_counters');
    await dataSource.query('DELETE FROM nest_outbox.messages');
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('commits rows and writes one outbox message per event when work returns ok', async () => {
    const id = randomUUIDv7();

    const result = await uow.run(async () => {
      const counter = Counter.create(id);
      counter.increment(1);
      await repo.save(counter);
      return ok(id);
    });

    expect(result).toEqual(ok(id));
    expect(await rows()).toBe(1);
    expect(await messages()).toMatchObject([
      { topic: 'test.counter.incremented', key: id },
    ]);
  });

  it('returns the same err and commits nothing when work returns err', async () => {
    const failure = err('business rule failed');

    const result = await uow.run(async () => {
      const counter = Counter.create(randomUUIDv7());
      counter.increment(1);
      await repo.save(counter);
      return failure;
    });

    expect(result).toBe(failure);
    expect(await rows()).toBe(0);
    expect(await messages()).toEqual([]);
  });

  it('rolls back and rethrows when work throws', async () => {
    const boom = new Error('boom');

    await expect(
      uow.run(async () => {
        await repo.save(Counter.create(randomUUIDv7()));
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await rows()).toBe(0);
  });

  it('nested run joins the outer transaction', async () => {
    const result = await uow.run(async () => {
      await repo.save(Counter.create(randomUUIDv7()));
      const inner = await uow.run(async () => {
        await repo.save(Counter.create(randomUUIDv7()));
        return ok('inner done');
      });
      expect(inner.ok).toBe(true);
      return err('outer fails after inner succeeded');
    });

    expect(result.ok).toBe(false);
    expect(await rows()).toBe(0);
  });

  it('concurrent saves of the same version: one ConcurrencyConflictError', async () => {
    const id = randomUUIDv7();
    await uow.run(async () => {
      await repo.save(Counter.create(id));
      return ok(undefined);
    });

    const attempt = () =>
      uow.run(async () => {
        const counter = await repo.findById(id);
        if (!counter) return err('missing');
        counter.increment(1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await repo.save(counter);
        return ok(counter.value);
      });

    const outcomes = await Promise.allSettled([attempt(), attempt()]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      ConcurrencyConflictError,
    );
    expect((await repo.findById(id))?.value).toBe(1);
  });

  it('write outside run throws InvariantViolation', async () => {
    await expect(
      repo.save(Counter.create(randomUUIDv7())),
    ).rejects.toBeInstanceOf(InvariantViolation);
    expect(await rows()).toBe(0);
  });

  it('outbox headers carry the request id when inside a request context', async () => {
    const ctx = moduleRef.get(RequestContext);

    await ctx.run(
      {
        requestId: 'req-abcdef12',
        ip: undefined,
        userAgent: undefined,
        actorId: 'user-1',
      },
      () =>
        uow.run(async () => {
          const counter = Counter.create(randomUUIDv7());
          counter.increment(2);
          await repo.save(counter);
          return ok(undefined);
        }),
    );

    expect((await messages())[0]?.headers).toEqual({
      'x-request-id': 'req-abcdef12',
      'x-actor-id': 'user-1',
    });
  });
});
