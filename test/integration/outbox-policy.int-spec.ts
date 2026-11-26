import { Logger } from '@nestjs/common';
import { Outbox, OutboxRelay } from '@nestjs/outbox';
import type { TestingModule } from '@nestjs/testing';
import { DataSource, type EntityManager } from 'typeorm';
import { OUTBOX_RETRY_ATTEMPTS } from '../../src/shared/infrastructure/persistence/outbox-policy.js';
import { createPersistenceApp } from './support/persistence-app.js';

describe('outbox delivery policy (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;

  beforeAll(async () => {
    moduleRef = await createPersistenceApp();
    dataSource = moduleRef.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM nest_outbox.messages');
    await dataSource.query('DELETE FROM nest_outbox.dead_letters');
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('a message without a handler is dead-lettered after OUTBOX_RETRY_ATTEMPTS attempts, and reported as an error', async () => {
    const errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const outbox = moduleRef.get<Outbox<EntityManager>>(Outbox);
    const relay = moduleRef.get(OutboxRelay);
    await dataSource.transaction(async (manager) => {
      await outbox.add(manager, {
        topic: 'test.nobody.listens',
        payload: { n: 1 },
      });
    });

    for (let attempt = 1; attempt <= OUTBOX_RETRY_ATTEMPTS; attempt += 1) {
      await relay.runOnce();
      // Skip the backoff wait: make the rescheduled message available immediately.
      await dataSource.query(
        'UPDATE nest_outbox.messages SET available_at = 0',
      );
    }

    expect(
      await dataSource.query('SELECT 1 FROM nest_outbox.messages'),
    ).toHaveLength(0);
    const deadLetters: { topic: string; reason: string }[] =
      await dataSource.query(
        'SELECT topic, reason FROM nest_outbox.dead_letters',
      );
    expect(deadLetters).toEqual([
      { topic: 'test.nobody.listens', reason: 'exhausted' },
    ]);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('test.nobody.listens'),
    );
    errorLog.mockRestore();
  });
});
