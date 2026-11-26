import { Email } from '../domain/email.js';
import { User, type UserId, type UserStatus } from '../domain/user.js';

/** Row shape of `users LEFT JOIN password_credentials`. */
export type UserRow = {
  id: string;
  email: string;
  email_verified_at: Date | null;
  status: UserStatus;
  locked_until: Date | null;
  token_version: number;
  created_at: Date;
  version: number;
  password_hash: string | null;
};

export const USER_COLUMNS = `u.id, u.email, u.email_verified_at, u.status, u.locked_until,
  u.token_version, u.created_at, u.version, pc.password_hash`;

export function toUser(row: UserRow): User {
  return User.reconstitute(
    row.id as UserId, // trusted boundary: the database only holds ids we generated
    {
      email: Email.fromPersistence(row.email),
      emailVerifiedAt: row.email_verified_at,
      passwordHash: row.password_hash,
      status: row.status,
      lockedUntil: row.locked_until,
      tokenVersion: row.token_version,
      createdAt: row.created_at,
    },
    row.version,
  );
}
