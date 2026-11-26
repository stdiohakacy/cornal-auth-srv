import {
  Argon2PasswordHasher,
  DUMMY_PASSWORD_HASH,
} from './argon2-password-hasher.js';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('verifies the right password and rejects the wrong one', async () => {
    const encoded = await hasher.hash('correct horse battery');
    expect(encoded.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    await expect(hasher.verify('correct horse battery', encoded)).resolves.toBe(
      true,
    );
    await expect(hasher.verify('wrong', encoded)).resolves.toBe(false);
    expect(hasher.needsRehash(encoded)).toBe(false);
  });

  it('rejects malformed hashes instead of throwing', async () => {
    await expect(hasher.verify('x', '$bcrypt$garbage')).resolves.toBe(false);
  });

  it('DUMMY_PASSWORD_HASH is a valid argon2id PHC string', async () => {
    expect(
      DUMMY_PASSWORD_HASH.startsWith('$argon2id$v=19$m=19456,t=2,p=1$'),
    ).toBe(true);
    expect(hasher.needsRehash(DUMMY_PASSWORD_HASH)).toBe(false);
    await expect(hasher.verify('anything', DUMMY_PASSWORD_HASH)).resolves.toBe(
      false,
    );
  });
});
