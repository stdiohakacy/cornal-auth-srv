import { Session } from './session.js';

const now = new Date('2026-11-27T10:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const idleTtlMs = 14 * DAY;

const started = (absoluteTtlMs = 30 * DAY) =>
  Session.start({
    userId: 'u1',
    refreshHash: 'h0',
    now,
    idleTtlMs,
    absoluteTtlMs,
    amr: ['pwd'],
    ip: '203.0.113.1',
    userAgent: 'test-agent',
  });

const rotate = (
  session: Session,
  presentedHash: string,
  nextHash: string,
  at: Date,
) =>
  session.rotate({
    presentedHash,
    nextHash,
    now: at,
    idleTtlMs,
    ip: '203.0.113.2',
    userAgent: 'ua-2',
  });

const later = (ms: number) => new Date(now.getTime() + ms);

describe('Session', () => {
  it('start raises session.started', () => {
    const session = started();

    expect(session.pendingEvents.map((e) => e.type)).toEqual([
      'session.started',
    ]);
    expect(session.snapshot.amr).toEqual(['pwd']);
  });

  it('rotate with current hash moves it to prev and extends idle', () => {
    const session = started();

    expect(rotate(session, 'h0', 'h1', later(MIN))).toEqual({
      ok: true,
      value: undefined,
    });
    expect(session.snapshot.refreshHash).toBe('h1');
    expect(session.snapshot.prevRefreshHashes).toEqual(['h0']);
    expect(session.snapshot.idleExpiresAt).toEqual(later(MIN + idleTtlMs));
    expect(session.snapshot.ip).toBe('203.0.113.2');
  });

  it('prev[0] within 10s → conflict, no revoke', () => {
    const session = started();
    rotate(session, 'h0', 'h1', later(MIN));

    expect(rotate(session, 'h0', 'hX', later(MIN + 5_000))).toMatchObject({
      ok: false,
      error: { code: 'SESSION.REFRESH_CONFLICT' },
    });
    expect(session.snapshot.revokedAt).toBeNull();
    expect(session.snapshot.refreshHash).toBe('h1');
  });

  it('older previous hash → revoke + reuse event', () => {
    const session = started();
    rotate(session, 'h0', 'h1', later(MIN));
    rotate(session, 'h1', 'h2', later(2 * MIN));
    session.pullEvents();

    expect(rotate(session, 'h0', 'hX', later(3 * MIN))).toMatchObject({
      ok: false,
      error: { code: 'SESSION.INVALID' },
    });
    expect(session.snapshot.revokedAt).toEqual(later(3 * MIN));
    expect(session.snapshot.revokeReason).toBe('reuse_detected');
    expect(session.pullEvents().map((e) => e.type)).toEqual([
      'session.revoked',
      'session.refresh_reuse_detected',
    ]);
  });

  it('prev[0] after the grace window is reuse too', () => {
    const session = started();
    rotate(session, 'h0', 'h1', later(MIN));

    expect(rotate(session, 'h0', 'hX', later(MIN + 11_000)).ok).toBe(false);
    expect(session.snapshot.revokeReason).toBe('reuse_detected');
  });

  it('unknown hash → invalid, nothing changes', () => {
    const session = started();
    const before = { ...session.snapshot };

    expect(rotate(session, 'forged', 'hX', later(MIN))).toMatchObject({
      ok: false,
      error: { code: 'SESSION.INVALID' },
    });
    expect(session.snapshot).toEqual(before);
  });

  it('idle expired → invalid', () => {
    const session = started();

    expect(rotate(session, 'h0', 'h1', later(idleTtlMs + 1)).ok).toBe(false);
  });

  it('never extends past absolute expiry', () => {
    const session = started(15 * DAY);

    rotate(session, 'h0', 'h1', later(10 * DAY));

    expect(session.snapshot.idleExpiresAt).toEqual(later(15 * DAY));
  });

  it('prev keeps at most 5', () => {
    const session = started();
    for (let i = 0; i < 7; i += 1)
      rotate(session, `h${i}`, `h${i + 1}`, later((i + 1) * MIN));

    expect(session.snapshot.prevRefreshHashes).toEqual([
      'h6',
      'h5',
      'h4',
      'h3',
      'h2',
    ]);
  });

  it('revoke is idempotent', () => {
    const session = started();
    session.pullEvents();

    session.revoke('logout', later(MIN));
    session.revoke('logout', later(2 * MIN));

    expect(session.snapshot.revokedAt).toEqual(later(MIN));
    expect(session.pullEvents().map((e) => e.type)).toEqual([
      'session.revoked',
    ]);
  });
});
