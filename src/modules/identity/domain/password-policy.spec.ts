import { checkPasswordPolicy } from './password-policy.js';

describe('checkPasswordPolicy', () => {
  it('rejects < 12 chars', () => {
    expect(checkPasswordPolicy('short-pass1')).toMatchObject({
      ok: false,
      error: { code: 'IDENTITY.WEAK_PASSWORD' },
    });
  });

  it('rejects > 256 chars', () => {
    expect(checkPasswordPolicy('x'.repeat(257)).ok).toBe(false);
  });

  it('rejects whitespace-only', () => {
    expect(checkPasswordPolicy(' '.repeat(20)).ok).toBe(false);
  });

  it('accepts a 12-char passphrase', () => {
    expect(checkPasswordPolicy('correct-horse').ok).toBe(true);
  });
});
