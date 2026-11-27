import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { DomainError } from '../../../shared/domain/domain-error.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import { ConcurrencyConflictError } from '../../../shared/domain/concurrency-conflict.error.js';
import type { Session, SessionId } from '../domain/session.js';
import type {
  AccessClaims,
  AccessTokenService,
  CredentialsVerifier,
  RefreshTokenFactory,
  SessionRepository,
  UserAuthStateReader,
  VerifiedUser,
} from './ports.js';

/** Test doubles for session use cases. Imported by *.spec.ts only. */
export const NOW = new Date('2026-11-27T10:00:00Z');
export const clockAt = (date: Date): Clock => ({ now: () => date });
export const passthroughUow: UnitOfWork = {
  run: <T, E>(work: () => Promise<Result<T, E>>) => work(),
};
export const TTL = { idleSeconds: 14 * 86_400, absoluteSeconds: 30 * 86_400 };

export class InMemorySessionRepository implements SessionRepository {
  readonly rows = new Map<SessionId, Session>();
  saves = 0;
  /** Simulates losing an optimistic-version race on the next save. */
  conflictOnNextSave = false;
  async findById(id: SessionId) {
    return this.rows.get(id);
  }
  async save(session: Session) {
    if (this.conflictOnNextSave) {
      this.conflictOnNextSave = false;
      throw new ConcurrencyConflictError('Session', session.id);
    }
    this.saves += 1;
    session.markPersisted();
    this.rows.set(session.id, session);
  }
}

export function sequentialRefreshTokens(): RefreshTokenFactory {
  let n = 0;
  return {
    newSecret: () => {
      n += 1;
      return { secret: `secret-${n}`, hash: `hash:secret-${n}` };
    },
    format: (sessionId, secret) => `${sessionId}.${secret}`,
    parse: (raw) => {
      const [sid, secret] = raw.split('.');
      return sid && secret
        ? { sessionId: sid as SessionId, hash: `hash:${secret}` }
        : undefined;
    },
  };
}

export function fakeAccessTokens() {
  const issued: AccessClaims[] = [];
  const service: AccessTokenService = {
    issue: async (claims) => {
      issued.push(claims);
      return { token: `access:${claims.sid}:${claims.uv}`, expiresIn: 600 };
    },
    verify: async () => undefined,
  };
  return { service, issued };
}

class FakeInvalidCredentials extends DomainError<'IDENTITY.INVALID_CREDENTIALS'> {
  readonly code = 'IDENTITY.INVALID_CREDENTIALS' as const;
}

export class FakeCredentials implements CredentialsVerifier<FakeInvalidCredentials> {
  readonly users = new Map<string, { password: string; user: VerifiedUser }>();
  async verify(input: {
    email: string;
    password: string;
  }): Promise<Result<VerifiedUser, FakeInvalidCredentials>> {
    const entry = this.users.get(input.email);
    return entry && entry.password === input.password
      ? ok(entry.user)
      : err(new FakeInvalidCredentials('Invalid email or password'));
  }
}

export class FakeAuthState implements UserAuthStateReader {
  readonly states = new Map<
    string,
    { tokenVersion: number; canAuthenticate: boolean }
  >();
  async get(userId: string) {
    return this.states.get(userId);
  }
}
