import type { DomainError } from '../../../shared/domain/domain-error.js';
import type { Result } from '../../../shared/domain/result.js';
import type { Session, SessionId } from '../domain/session.js';

/** Organization scope of an access token (absent when no org is selected). */
export type OrgClaims = {
  readonly orgId: string;
  readonly membershipId: string;
  /** membership.authz_version */
  readonly mv: number;
  /** organization.authz_epoch */
  readonly ov: number;
  /** permission-catalog version used to encode pbits */
  readonly pcv: number;
  readonly pbits: string;
};

/** Claims this service puts in access tokens. */
export type AccessClaims = {
  readonly sub: string;
  readonly sid: string;
  /** user.tokenVersion at issue time. */
  readonly uv: number;
  readonly amr: readonly string[];
  readonly authTime: Date;
  readonly org?: OrgClaims;
};

export const ACCESS_TOKEN_SERVICE = Symbol('ACCESS_TOKEN_SERVICE');
export interface AccessTokenService {
  issue(claims: AccessClaims): Promise<{ token: string; expiresIn: number }>;
  /** undefined for anything not issued by us and still valid (signature, iss, aud, exp, alg). */
  verify(token: string): Promise<AccessClaims | undefined>;
}

export const REFRESH_TOKEN_FACTORY = Symbol('REFRESH_TOKEN_FACTORY');
/** Refresh token = `<sessionId>.<secret>`; only sha256(secret) is persisted. */
export interface RefreshTokenFactory {
  newSecret(): { secret: string; hash: string };
  format(sessionId: SessionId, secret: string): string;
  parse(raw: string): { sessionId: SessionId; hash: string } | undefined;
}

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');
export interface SessionRepository {
  findById(id: SessionId): Promise<Session | undefined>;
  /** Active (not revoked, not expired) sessions of a user, most recent activity first. */
  listActiveByUser(userId: string, now: Date): Promise<Session[]>;
  /** The org of the user's most recently active session that had one (login default). */
  lastActiveOrgOf(userId: string): Promise<string | null>;
  /** Insert or optimistic update; throws ConcurrencyConflictError on a stale version. */
  save(session: Session): Promise<void>;
}

/** Identity façades, adapted in session-core.module.ts (session never reads identity tables). */
export type VerifiedUser = {
  readonly userId: string;
  readonly tokenVersion: number;
};

export const CREDENTIALS_VERIFIER = Symbol('CREDENTIALS_VERIFIER');
export interface CredentialsVerifier<E extends DomainError> {
  verify(input: {
    email: string;
    password: string;
  }): Promise<Result<VerifiedUser, E>>;
}

export const USER_AUTH_STATE = Symbol('USER_AUTH_STATE');
export interface UserAuthStateReader {
  get(
    userId: string,
  ): Promise<{ tokenVersion: number; canAuthenticate: boolean } | undefined>;
}

export type OrgContext = OrgClaims & { readonly mfaRequired: boolean };

/** Organization façade (ResolveOrgContextUseCase), adapted in session-core.module.ts. */
export const ORG_CONTEXT_READER = Symbol('ORG_CONTEXT_READER');
export interface OrgContextReader {
  contextFor(userId: string, orgId: string): Promise<OrgContext | undefined>;
  defaultFor(
    userId: string,
    preferredOrgId: string | null,
  ): Promise<OrgContext | undefined>;
}

/** OrgContext without the policy flag: what goes into the token. */
export const toOrgClaims = ({
  mfaRequired: _policy,
  ...claims
}: OrgContext): OrgClaims => claims;

/** MFA-enforcing orgs are only usable by sessions that proved a second factor. */
export const orgAllowedFor = (
  context: OrgContext,
  amr: readonly string[],
): boolean => !context.mfaRequired || amr.includes('otp');
