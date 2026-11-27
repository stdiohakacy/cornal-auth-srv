import type { Session } from '../domain/session.js';
import {
  type AccessTokenService,
  type OrgContext,
  type RefreshTokenFactory,
  toOrgClaims,
} from './ports.js';

/** What login and refresh hand to the presentation layer (cookie vs body is decided there). */
export type IssuedTokens = {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: string;
  /** Seconds until the session's idle expiry: the refresh cookie's Max-Age. */
  readonly refreshMaxAgeSeconds: number;
};

export type SessionTtl = {
  readonly idleSeconds: number;
  readonly absoluteSeconds: number;
};

export const secondsUntil = (from: Date, to: Date): number =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));

const MS_PER_SECOND = 1000;
export const idleTtlMs = (ttl: SessionTtl): number =>
  ttl.idleSeconds * MS_PER_SECOND;
export const absoluteTtlMs = (ttl: SessionTtl): number =>
  ttl.absoluteSeconds * MS_PER_SECOND;

/** Who the access token speaks for: the session, the user's token version and the active org. */
export type SessionGrant = {
  readonly session: Session;
  readonly tokenVersion: number;
  readonly org: OrgContext | undefined;
};

export function issueAccessToken(
  accessTokens: AccessTokenService,
  { session, tokenVersion, org }: SessionGrant,
): Promise<{ token: string; expiresIn: number }> {
  return accessTokens.issue({
    sub: session.userId,
    sid: session.id,
    uv: tokenVersion,
    amr: session.snapshot.amr,
    authTime: session.snapshot.authTime,
    ...(org ? { org: toOrgClaims(org) } : {}),
  });
}

/** Access token + `<sid>.<secret>` refresh token, with the cookie lifetime of the session. */
export async function issueTokenPair(
  tokens: {
    readonly access: AccessTokenService;
    readonly refresh: RefreshTokenFactory;
  },
  grant: SessionGrant & { readonly secret: string; readonly now: Date },
): Promise<IssuedTokens> {
  const access = await issueAccessToken(tokens.access, grant);
  return {
    accessToken: access.token,
    expiresIn: access.expiresIn,
    refreshToken: tokens.refresh.format(grant.session.id, grant.secret),
    refreshMaxAgeSeconds: secondsUntil(
      grant.now,
      grant.session.snapshot.idleExpiresAt,
    ),
  };
}
