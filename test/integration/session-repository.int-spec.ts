import { randomUUIDv7 } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { Session } from '../../src/modules/session/domain/session.js';
import { TypeOrmSessionRepository } from '../../src/modules/session/infrastructure/typeorm-session.repository.js';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../src/shared/application/ports.js';
import { ok } from '../../src/shared/domain/result.js';
import { ConcurrencyConflictError } from '../../src/shared/domain/concurrency-conflict.error.js';
import { TransactionContext } from '../../src/shared/infrastructure/persistence/transaction-context.js';
import { createPersistenceApp } from './support/persistence-app.js';

const hex = (n: number) => n.toString(16).padStart(64, '0');

describe('TypeOrmSessionRepository (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let uow: UnitOfWork;
  let sessions: TypeOrmSessionRepository;

  const saveInTx = (session: Session) =>
    uow.run(async () => {
      await sessions.save(session);
      return ok(undefined);
    });

  async function userId(): Promise<string> {
    const id = randomUUIDv7();
    await dataSource.query('INSERT INTO users (id, email) VALUES ($1, $2)', [
      id,
      `${id}@test.local`,
    ]);
    return id;
  }

  const start = async () =>
    Session.start({
      userId: await userId(),
      refreshHash: hex(1),
      now: new Date('2026-11-27T10:00:00Z'),
      idleTtlMs: 14 * 86_400_000,
      absoluteTtlMs: 30 * 86_400_000,
      amr: ['pwd'],
      ip: '203.0.113.9',
      userAgent: 'integration-agent',
    });

  beforeAll(async () => {
    moduleRef = await createPersistenceApp();
    dataSource = moduleRef.get(DataSource);
    uow = moduleRef.get<UnitOfWork>(UNIT_OF_WORK);
    sessions = new TypeOrmSessionRepository(
      dataSource,
      moduleRef.get(TransactionContext),
    );
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('round-trips a session including prev hashes, amr, ip, ua', async () => {
    const session = await start();
    await saveInTx(session);
    session.rotate({
      presentedHash: hex(1),
      nextHash: hex(2),
      now: new Date('2026-11-27T10:05:00Z'),
      idleTtlMs: 14 * 86_400_000,
      ip: '203.0.113.10',
      userAgent: 'agent-2',
    });
    await saveInTx(session);

    const loaded = await sessions.findById(session.id);

    expect(loaded?.version).toBe(2);
    expect(loaded?.snapshot).toEqual(session.snapshot);
    expect(loaded?.snapshot.prevRefreshHashes).toEqual([hex(1)]);
  });

  it('listActiveByUser excludes revoked and idle-expired sessions, newest activity first', async () => {
    const owner = await userId();
    const at = (iso: string) => new Date(iso);
    const make = (now: Date, idleTtlMs = 14 * 86_400_000) =>
      Session.start({
        userId: owner,
        refreshHash: hex(Math.floor(Math.random() * 1e9)),
        now,
        idleTtlMs,
        absoluteTtlMs: 30 * 86_400_000,
        amr: ['pwd'],
        ip: null,
        userAgent: null,
      });
    const older = make(at('2026-11-27T08:00:00Z'));
    const newer = make(at('2026-11-27T09:00:00Z'));
    const revoked = make(at('2026-11-27T09:30:00Z'));
    revoked.revoke('logout', at('2026-11-27T09:31:00Z'));
    const expired = make(at('2026-11-20T09:00:00Z'), 60_000);
    for (const s of [older, newer, revoked, expired]) await saveInTx(s);

    const listed = await sessions.listActiveByUser(
      owner,
      at('2026-11-27T10:00:00Z'),
    );

    expect(listed.map((s) => s.id)).toEqual([newer.id, older.id]);
  });

  it('stale version → ConcurrencyConflictError', async () => {
    const session = await start();
    await saveInTx(session);
    const first = await sessions.findById(session.id);
    const second = await sessions.findById(session.id);
    if (!first || !second) throw new Error('session not found');

    first.revoke('logout', new Date());
    await saveInTx(first);
    second.revoke('admin', new Date());

    await expect(saveInTx(second)).rejects.toBeInstanceOf(
      ConcurrencyConflictError,
    );
  });
});
