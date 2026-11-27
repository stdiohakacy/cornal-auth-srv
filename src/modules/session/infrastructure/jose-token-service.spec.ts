import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, decodeProtectedHeader } from 'jose';
import { JoseTokenService } from './jose-token-service.js';
import { KeyRing } from './key-ring.js';

const ISSUER = 'https://auth.test';
const AUDIENCE = 'cornal-platform';
const claims = {
  sub: 'user-1',
  sid: 'session-1',
  uv: 2,
  amr: ['pwd'],
  authTime: new Date('2026-11-27T10:00:00Z'),
};
const pem = () =>
  generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ format: 'pem', type: 'pkcs8' })
    .toString();

async function setup(ttlSeconds = 600) {
  const ring = await KeyRing.fromConfig([{ kid: 'k1', pem: pem() }], 'test');
  return {
    ring,
    service: new JoseTokenService(ring, ISSUER, AUDIENCE, ttlSeconds),
  };
}

describe('JoseTokenService', () => {
  it('issue → verify round-trip carries claims and kid', async () => {
    const { service } = await setup();

    const { token, expiresIn } = await service.issue(claims);

    expect(expiresIn).toBe(600);
    expect(decodeProtectedHeader(token)).toMatchObject({
      alg: 'ES256',
      kid: 'k1',
      typ: 'at+jwt',
    });
    expect(await service.verify(token)).toEqual(claims);
  });

  it('rejects wrong audience, wrong issuer, expired, foreign key, alg none', async () => {
    const { service } = await setup();
    const foreignKey = await importPKCS8(pem(), 'ES256');
    const sign = (
      key: CryptoKey,
      opts: { iss?: string; aud?: string; exp?: number; kid?: string } = {},
    ) =>
      new SignJWT({ sid: 's', uv: 0, amr: ['pwd'], auth_time: 1 })
        .setProtectedHeader({ alg: 'ES256', kid: opts.kid ?? 'k1' })
        .setSubject('u')
        .setIssuer(opts.iss ?? ISSUER)
        .setAudience(opts.aud ?? AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(opts.exp ?? '10m')
        .sign(key);

    expect(await service.verify(await sign(foreignKey))).toBeUndefined();
    expect(
      await service.verify(await sign(foreignKey, { kid: 'unknown' })),
    ).toBeUndefined();

    const { ring } = await setup();
    const own = new JoseTokenService(ring, ISSUER, AUDIENCE, 600);
    const ownKey = ring.signer.key;
    expect(
      await own.verify(await sign(ownKey, { aud: 'someone-else' })),
    ).toBeUndefined();
    expect(
      await own.verify(await sign(ownKey, { iss: 'https://evil.test' })),
    ).toBeUndefined();
    expect(
      await own.verify(
        await sign(ownKey, { exp: Math.floor(Date.now() / 1000) - 120 }),
      ),
    ).toBeUndefined();

    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub: 'u', iss: ISSUER, aud: AUDIENCE }),
    ).toString('base64url');
    expect(await own.verify(`${header}.${body}.`)).toBeUndefined();
    expect(await own.verify('not-a-jwt')).toBeUndefined();
  });

  it('org claims round-trip; absent when there is no active org', async () => {
    const { service } = await setup();
    const org = {
      orgId: 'org-1',
      membershipId: 'm-1',
      mv: 2,
      ov: 1,
      pcv: 1,
      pbits: 'Fw',
    };

    const withOrg = await service.verify(
      (await service.issue({ ...claims, org })).token,
    );
    const withoutOrg = await service.verify(
      (await service.issue(claims)).token,
    );

    expect(withOrg?.org).toEqual(org);
    expect(withoutOrg?.org).toBeUndefined();
  });
});
