import { HashAdmissionGate } from '#src/shared/infrastructure/hash-admission-gate.js';
import type { Argon2PasswordHasher } from './argon2-password-hasher.js';
import { GatedPasswordHasher } from './gated-password-hasher.js';

describe('GatedPasswordHasher', () => {
  it('returns ServiceBusyError when the gate is saturated', async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
    const inner = {
      hash: vi.fn<Argon2PasswordHasher['hash']>(async () => 'h'),
      verify: vi.fn<Argon2PasswordHasher['verify']>(() => slow),
      needsRehash: vi.fn<Argon2PasswordHasher['needsRehash']>(() => false),
    } as unknown as Argon2PasswordHasher;
    const hasher = new GatedPasswordHasher(inner, new HashAdmissionGate(1, 0));

    const running = hasher.verify('a', 'b');
    const rejected = await hasher.verify('a', 'b');
    release();

    expect(rejected).toMatchObject({
      ok: false,
      error: {
        code: 'COMMON.SERVICE_UNAVAILABLE',
        details: { retryAfterSeconds: 1 },
      },
    });
    expect(await running).toEqual({ ok: true, value: true });
  });
});
