import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import { ServiceBusyError } from '../../../shared/domain/service-busy.error.js';
import { Email } from '../domain/email.js';
import { EmailTakenError } from '../domain/identity.errors.js';
import { User, type UserId } from '../domain/user.js';
import type {
  EmailMessage,
  EmailSender,
  LoginAttemptCounter,
  OneTimeTokenRepository,
  PasswordHasher,
  SecretTokenGenerator,
  TokenPurpose,
  UserRepository,
} from './ports.js';

/** Test doubles for identity use cases. Imported by *.spec.ts only. */
export const NOW = new Date('2026-11-26T10:00:00Z');
export const fixedClock: Clock = { now: () => NOW };
export const passthroughUow: UnitOfWork = {
  run: <T, E>(work: () => Promise<Result<T, E>>) => work(),
};

export function emailOf(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

export class InMemoryUserRepository implements UserRepository {
  readonly rows = new Map<UserId, User>();
  /** Simulates losing the unique-index race on insert. */
  failNextSaveWithEmailTaken = false;
  async findById(id: UserId) {
    return this.rows.get(id);
  }
  async findByEmail(email: Email) {
    return [...this.rows.values()].find((u) => u.email.equals(email));
  }
  async save(user: User) {
    if (this.failNextSaveWithEmailTaken) {
      this.failNextSaveWithEmailTaken = false;
      throw new EmailTakenError();
    }
    user.markPersisted();
    this.rows.set(user.id, user);
  }
  seed(raw: string, passwordHash = `hashed:correct-horse-battery`): User {
    const user = User.register({ email: emailOf(raw), passwordHash, now: NOW });
    user.markPersisted();
    user.pullEvents();
    this.rows.set(user.id, user);
    return user;
  }
}

type StoredToken = {
  purpose: TokenPurpose;
  userId: UserId;
  tokenHash: string;
  expiresAt: Date;
  consumed: boolean;
};

export class InMemoryOneTimeTokens implements OneTimeTokenRepository {
  readonly tokens: StoredToken[] = [];
  async issue(input: {
    purpose: TokenPurpose;
    userId: UserId;
    tokenHash: string;
    expiresAt: Date;
  }) {
    this.tokens.push({ ...input, consumed: false });
  }
  async revokeOpen(userId: UserId, purpose: TokenPurpose) {
    for (const t of this.tokens)
      if (t.userId === userId && t.purpose === purpose) t.consumed = true;
  }
  async consume(purpose: TokenPurpose, tokenHash: string, now: Date) {
    const token = this.tokens.find(
      (t) =>
        t.purpose === purpose &&
        t.tokenHash === tokenHash &&
        !t.consumed &&
        t.expiresAt > now,
    );
    if (!token) return undefined;
    token.consumed = true;
    return { userId: token.userId };
  }
  open(userId: UserId) {
    return this.tokens.filter((t) => t.userId === userId && !t.consumed);
  }
}

export function fakeHasher() {
  const hash = vi.fn<PasswordHasher['hash']>(async (plain) =>
    ok(`hashed:${plain}`),
  );
  const verify = vi.fn<PasswordHasher['verify']>(async (plain, encoded) =>
    ok(encoded === `hashed:${plain}`),
  );
  const hasher: PasswordHasher = { hash, verify, needsRehash: () => false };
  return { hasher, hash, verify };
}

export class InMemoryAttemptCounter implements LoginAttemptCounter {
  readonly counts = new Map<UserId, number>();
  /** Simulates Redis being down. */
  unavailable = false;
  async registerFailure(userId: UserId) {
    if (this.unavailable) return err(new ServiceBusyError(1));
    const next = (this.counts.get(userId) ?? 0) + 1;
    this.counts.set(userId, next);
    return ok(next);
  }
  async reset(userId: UserId) {
    if (this.unavailable) return err(new ServiceBusyError(1));
    this.counts.delete(userId);
    return ok(undefined);
  }
}

export function sequentialTokens(): SecretTokenGenerator {
  let n = 0;
  return {
    generate: () => {
      n += 1;
      return { raw: `raw-${n}`, hash: `hash:raw-${n}` };
    },
    hash: (raw) => `hash:${raw}`,
  };
}

export function capturingEmailSender() {
  const sent: EmailMessage[] = [];
  const send = vi.fn<EmailSender['send']>(async (message) => {
    sent.push(message);
  });
  return { sender: { send } satisfies EmailSender, send, sent };
}
