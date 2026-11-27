import { Session } from '../domain/session.js';
import { ListSessionsUseCase } from './list-sessions.use-case.js';
import { RevokeAllSessionsUseCase } from './revoke-all-sessions.use-case.js';
import { RevokeSessionUseCase } from './revoke-session.use-case.js';
import {
  clockAt,
  InMemorySessionRepository,
  NOW,
  passthroughUow,
  TTL,
} from './session.test-support.js';

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

async function setup() {
  const sessions = new InMemorySessionRepository();
  const start = async (userId: string, startedAt: Date, ip = '203.0.113.1') => {
    const session = Session.start({
      userId,
      refreshHash: `hash-${Math.random()}`,
      now: startedAt,
      idleTtlMs: TTL.idleSeconds * 1000,
      absoluteTtlMs: TTL.absoluteSeconds * 1000,
      amr: ['pwd'],
      ip,
      userAgent: 'Mozilla/5.0 test',
    });
    await sessions.save(session);
    return session;
  };
  const laptop = await start('u1', minutesAgo(30));
  const phone = await start('u1', minutesAgo(5), '198.51.100.7');
  const old = await start('u1', minutesAgo(60));
  old.revoke('logout', minutesAgo(50));
  const stranger = await start('u2', minutesAgo(10));
  const clock = clockAt(NOW);
  return {
    sessions,
    laptop,
    phone,
    old,
    stranger,
    list: new ListSessionsUseCase(sessions, clock),
    revokeOne: new RevokeSessionUseCase(sessions, passthroughUow, clock),
    revokeAll: new RevokeAllSessionsUseCase(sessions, passthroughUow, clock),
  };
}

describe('ListSessionsUseCase', () => {
  it('returns only active sessions of the user, newest activity first, flags current', async () => {
    const { list, laptop, phone } = await setup();

    const views = await list.execute({
      userId: 'u1',
      currentSessionId: laptop.id,
    });

    expect(views).toEqual([
      {
        id: phone.id,
        current: false,
        createdAt: minutesAgo(5),
        lastActiveAt: minutesAgo(5),
        ip: '198.51.100.7',
        userAgent: 'Mozilla/5.0 test',
      },
      expect.objectContaining({ id: laptop.id, current: true }),
    ]);
  });
});

describe('RevokeSessionUseCase', () => {
  it('revokes own session', async () => {
    const { revokeOne, phone } = await setup();

    expect(
      await revokeOne.execute({ userId: 'u1', sessionId: phone.id }),
    ).toEqual({ ok: true, value: undefined });
    expect(phone.snapshot.revokeReason).toBe('logout');
  });

  it("another user's session → SessionNotFound and untouched", async () => {
    const { revokeOne, stranger } = await setup();

    expect(
      await revokeOne.execute({ userId: 'u1', sessionId: stranger.id }),
    ).toMatchObject({
      ok: false,
      error: { code: 'SESSION.NOT_FOUND' },
    });
    expect(stranger.snapshot.revokedAt).toBeNull();
  });

  it('already revoked → SessionNotFound', async () => {
    const { revokeOne, old } = await setup();

    expect(
      await revokeOne.execute({ userId: 'u1', sessionId: old.id }),
    ).toMatchObject({
      ok: false,
      error: { code: 'SESSION.NOT_FOUND' },
    });
  });
});

describe('RevokeAllSessionsUseCase', () => {
  it('revokes all active sessions except the given one', async () => {
    const { revokeAll, laptop, phone, stranger } = await setup();

    const result = await revokeAll.execute({
      userId: 'u1',
      reason: 'logout',
      exceptSessionId: laptop.id,
    });

    expect(result).toEqual({ ok: true, value: { revoked: 1 } });
    expect(phone.snapshot.revokeReason).toBe('logout');
    expect(laptop.snapshot.revokedAt).toBeNull();
    expect(stranger.snapshot.revokedAt).toBeNull();
  });

  it('with no exception revokes all', async () => {
    const { revokeAll, laptop, phone } = await setup();

    expect(
      await revokeAll.execute({ userId: 'u1', reason: 'password_changed' }),
    ).toEqual({
      ok: true,
      value: { revoked: 2 },
    });
    expect([laptop.snapshot.revokeReason, phone.snapshot.revokeReason]).toEqual(
      ['password_changed', 'password_changed'],
    );
  });
});
