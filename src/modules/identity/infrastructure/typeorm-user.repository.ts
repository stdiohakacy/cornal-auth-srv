import { DataSource, type EntityManager } from 'typeorm';
import { first } from '../../../shared/domain/guard.js';
import { ConcurrencyConflictError } from '../../../shared/infrastructure/persistence/concurrency-conflict.error.js';
import { isUniqueViolation } from '../../../shared/infrastructure/persistence/pg-errors.js';
import { TransactionContext } from '../../../shared/infrastructure/persistence/transaction-context.js';
import type { UserRepository } from '../application/ports.js';
import type { Email } from '../domain/email.js';
import { EmailTakenError } from '../domain/identity.errors.js';
import type { User, UserId } from '../domain/user.js';
import { toUser, USER_COLUMNS, type UserRow } from './user.mapper.js';

/** Hand-written SQL: one aggregate over `users` + `password_credentials`, optimistic version. */
export class TypeOrmUserRepository implements UserRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tx: TransactionContext,
  ) {}

  async findById(id: UserId): Promise<User | undefined> {
    return this.findOne('u.id = $1', id);
  }

  async findByEmail(email: Email): Promise<User | undefined> {
    return this.findOne('u.email = $1', email.value);
  }

  async save(user: User): Promise<void> {
    const manager = this.tx.requireManager();
    if (user.version === 0) {
      await this.insert(manager, user);
    } else {
      await this.update(manager, user);
    }
    if (user.passwordHash !== null) {
      await manager.query(
        `INSERT INTO password_credentials (user_id, password_hash) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           password_changed_at = CASE
             WHEN password_credentials.password_hash <> EXCLUDED.password_hash THEN now()
             ELSE password_credentials.password_changed_at END`,
        [user.id, user.passwordHash],
      );
    }
    user.markPersisted();
    this.tx.track(user);
  }

  private async insert(manager: EntityManager, user: User): Promise<void> {
    try {
      await manager.query(
        `INSERT INTO users (id, email, email_verified_at, status, locked_until, token_version, created_at, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
        [
          user.id,
          user.email.value,
          user.emailVerifiedAt,
          user.status,
          user.lockedUntil,
          user.tokenVersion,
          user.createdAt,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_uq'))
        throw new EmailTakenError();
      throw error;
    }
  }

  private async update(manager: EntityManager, user: User): Promise<void> {
    const [, affected]: [unknown, number] = await manager.query(
      `UPDATE users SET email = $3, email_verified_at = $4, status = $5, locked_until = $6,
         token_version = $7, updated_at = now(), version = version + 1
       WHERE id = $1 AND version = $2`,
      [
        user.id,
        user.version,
        user.email.value,
        user.emailVerifiedAt,
        user.status,
        user.lockedUntil,
        user.tokenVersion,
      ],
    );
    if (affected !== 1) throw new ConcurrencyConflictError('User', user.id);
  }

  /** Reads join the active transaction when there is one (read-your-writes). */
  private async findOne(
    where: string,
    value: string,
  ): Promise<User | undefined> {
    const manager = this.tx.active?.manager ?? this.dataSource.manager;
    const rows: UserRow[] = await manager.query(
      `SELECT ${USER_COLUMNS} FROM users u
       LEFT JOIN password_credentials pc ON pc.user_id = u.id
       WHERE ${where} AND u.status <> 'deleted'`,
      [value],
    );
    const row = first(rows);
    return row ? toUser(row) : undefined;
  }
}
