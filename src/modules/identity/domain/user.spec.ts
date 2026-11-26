import { Email } from './email.js';
import { User } from './user.js';

const now = new Date('2026-11-26T10:00:00Z');

function registered(): User {
  const email = Email.create('a@b.co');
  if (!email.ok) throw email.error;
  return User.register({
    email: email.value,
    passwordHash: '$argon2id$x',
    now,
  });
}

describe('User', () => {
  it('register raises identity.user.registered', () => {
    const user = registered();
    expect(user.pendingEvents.map((e) => e.type)).toEqual([
      'identity.user.registered',
    ]);
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.tokenVersion).toBe(0);
  });

  it('verifyEmail is idempotent and raises once', () => {
    const user = registered();
    user.pullEvents();

    user.verifyEmail(now);
    user.verifyEmail(new Date(now.getTime() + 1000));

    expect(user.emailVerifiedAt).toEqual(now);
    expect(user.pullEvents().map((e) => e.type)).toEqual([
      'identity.user.email_verified',
    ]);
  });

  it('ensureCanAttemptLogin: locked until future → AccountLocked; expired lock → ok; disabled → InvalidCredentials', () => {
    const locked = registered();
    locked.lock(now, 15 * 60_000);
    expect(locked.ensureCanAttemptLogin(now)).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.ACCOUNT_LOCKED' },
    });
    expect(
      locked.ensureCanAttemptLogin(new Date(now.getTime() + 16 * 60_000)).ok,
    ).toBe(true);

    const disabled = User.reconstitute(
      locked.id,
      {
        email: locked.email,
        emailVerifiedAt: null,
        passwordHash: null,
        status: 'disabled',
        lockedUntil: null,
        tokenVersion: 0,
        createdAt: now,
      },
      1,
    );
    expect(disabled.ensureCanAttemptLogin(now)).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.INVALID_CREDENTIALS' },
    });
  });

  it('lock raises identity.user.locked with until', () => {
    const user = registered();
    user.pullEvents();

    user.lock(now, 60_000);

    const [event] = user.pullEvents();
    expect(event).toMatchObject({
      type: 'identity.user.locked',
      payload: { until: '2026-11-26T10:01:00.000Z' },
    });
    expect(user.status).toBe('locked');
  });

  it('clearExpiredLock unlocks only after the lock expired', () => {
    const user = registered();
    user.lock(now, 60_000);
    expect(user.clearExpiredLock(now)).toBe(false);
    expect(user.clearExpiredLock(new Date(now.getTime() + 60_000))).toBe(true);
    expect(user.status).toBe('active');
  });

  it('noteRegistrationAttempt raises identity.user.registration_attempted', () => {
    const user = registered();
    user.pullEvents();

    user.noteRegistrationAttempt(now);

    expect(user.pullEvents().map((e) => e.type)).toEqual([
      'identity.user.registration_attempted',
    ]);
  });
});
