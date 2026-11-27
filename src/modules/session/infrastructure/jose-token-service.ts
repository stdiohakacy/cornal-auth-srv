import { randomUUIDv7 } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type {
  AccessClaims,
  AccessTokenService,
  OrgClaims,
} from '../application/ports.js';
import type { KeyRing } from './key-ring.js';

/** RFC 9068 access-token media type, so ID tokens or other JWTs are never accepted as access tokens. */
const TOKEN_TYPE = 'at+jwt';
const CLOCK_TOLERANCE_SECONDS = 30;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export class JoseTokenService implements AccessTokenService {
  constructor(
    private readonly keys: KeyRing,
    private readonly issuer: string,
    private readonly audience: string,
    private readonly ttlSeconds: number,
  ) {}

  async issue(
    claims: AccessClaims,
  ): Promise<{ token: string; expiresIn: number }> {
    const token = await new SignJWT({
      sid: claims.sid,
      uv: claims.uv,
      amr: [...claims.amr],
      auth_time: Math.floor(claims.authTime.getTime() / 1000),
      ...(claims.org
        ? {
            org: claims.org.orgId,
            mid: claims.org.membershipId,
            mv: claims.org.mv,
            ov: claims.org.ov,
            pcv: claims.org.pcv,
            pbits: claims.org.pbits,
          }
        : {}),
    })
      .setProtectedHeader({
        alg: 'ES256',
        kid: this.keys.signer.kid,
        typ: TOKEN_TYPE,
      })
      .setSubject(claims.sub)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setJti(randomUUIDv7())
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.keys.signer.key);
    return { token, expiresIn: this.ttlSeconds };
  }

  async verify(token: string): Promise<AccessClaims | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.keys.verificationKeys, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['ES256'],
        typ: TOKEN_TYPE,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      const { sub, sid, uv, amr, auth_time: authTime } = payload;
      if (
        typeof sub !== 'string' ||
        typeof sid !== 'string' ||
        typeof uv !== 'number' ||
        !isStringArray(amr) ||
        typeof authTime !== 'number'
      ) {
        return undefined;
      }
      const org = readOrgClaims(payload);
      if (org === null) return undefined; // partial org claims: not a token we issued
      return {
        sub,
        sid,
        uv,
        amr,
        authTime: new Date(authTime * 1000),
        ...(org ? { org } : {}),
      };
    } catch {
      return undefined; // bad signature, unknown kid, wrong iss/aud/typ, expired, malformed
    }
  }
}

/** All six org claims, none of them (undefined), or a malformed mix (null). */
function readOrgClaims(
  payload: Record<string, unknown>,
): OrgClaims | undefined | null {
  const { org, mid, mv, ov, pcv, pbits } = payload;
  if ([org, mid, mv, ov, pcv, pbits].every((value) => value === undefined))
    return undefined;
  if (
    typeof org === 'string' &&
    typeof mid === 'string' &&
    typeof mv === 'number' &&
    typeof ov === 'number' &&
    typeof pcv === 'number' &&
    typeof pbits === 'string'
  ) {
    return { orgId: org, membershipId: mid, mv, ov, pcv, pbits };
  }
  return null;
}
