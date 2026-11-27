import { ensureCanTouch, isSubset } from './authorization-policy.js';

describe('authorization policy', () => {
  it('isSubset', () => {
    expect(isSubset([], [])).toBe(true);
    expect(isSubset(['org:read'], ['org:read', 'member:read'])).toBe(true);
    expect(isSubset(['org:manage'], ['org:read'])).toBe(false);
  });

  it('ensureCanTouch: subset ok; superset → ORG.INSUFFICIENT_PRIVILEGE', () => {
    const actor = ['org:read', 'member:read', 'member:manage'];

    expect(ensureCanTouch(actor, ['org:read'], ['member:read']).ok).toBe(true);
    expect(ensureCanTouch(actor, ['org:read'], ['org:manage'])).toMatchObject({
      ok: false,
      error: { code: 'ORG.INSUFFICIENT_PRIVILEGE' },
    });
  });
});
