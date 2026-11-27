import { generateKeyPairSync } from 'node:crypto';
import { KeyRing } from './key-ring.js';

const pem = () =>
  generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ format: 'pem', type: 'pkcs8' })
    .toString();

describe('KeyRing', () => {
  it('signs with the first key and publishes every public key without private parts', async () => {
    const ring = await KeyRing.fromConfig(
      [
        { kid: 'new', pem: pem() },
        { kid: 'old', pem: pem() },
      ],
      'test',
    );

    expect(ring.signer.kid).toBe('new');
    const { keys } = ring.jwks();
    expect(keys.map((k) => k.kid)).toEqual(['new', 'old']);
    for (const key of keys) {
      expect(key).toMatchObject({
        kty: 'EC',
        crv: 'P-256',
        alg: 'ES256',
        use: 'sig',
      });
      expect(key).not.toHaveProperty('d');
    }
  });

  it('ephemeral key in development, refused in production', async () => {
    const ring = await KeyRing.fromConfig(undefined, 'development');
    expect(ring.signer.kid).toMatch(/^ephemeral-/);

    await expect(KeyRing.fromConfig(undefined, 'production')).rejects.toThrow(
      /JWT_SIGNING_KEYS/,
    );
  });

  it('rejects a key that is not P-256', async () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString();

    await expect(
      KeyRing.fromConfig([{ kid: 'rsa', pem: rsa }], 'test'),
    ).rejects.toThrow(/EC P-256/);
  });
});
