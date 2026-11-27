import type { DomainError } from '../../../shared/domain/domain-error.js';
import type { Result } from '../../../shared/domain/result.js';
import type { Session, SessionId } from '../domain/session.js';

/** Claims this service puts in access tokens (organisation claims arrive in Phase 5). */
export type AccessClaims = {
  readonly sub: string;
  readonly sid: string;
  /** user.tokenVersion at issue time. */
  readonly uv: number;
  readonly amr: readonly string[];
  readonly authTime: Date;
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
