import type { DataSource, EntityManager } from 'typeorm';
import { first } from '../../../shared/domain/guard.js';
import { ConcurrencyConflictError } from '../../../shared/domain/concurrency-conflict.error.js';
import type { TransactionContext } from '../../../shared/infrastructure/persistence/transaction-context.js';
import type { SessionRepository } from '../application/ports.js';
import {
  type RevokeReason,
  Session,
  type SessionId,
} from '../domain/session.js';

type SessionRow = {
  id: string;
  user_id: string;
  refresh_hash: string;
  prev_refresh_hashes: string[];
  rotated_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
  revoke_reason: RevokeReason | null;
  amr: string[];
  auth_time: Date;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
  last_active_at: Date;
  version: number;
};

/** Hashes are hex in the domain, bytea in PostgreSQL; order of previous hashes is preserved. */
const SELECT_COLUMNS = `id, user_id, encode(refresh_hash, 'hex') AS refresh_hash,
  ARRAY(SELECT encode(h, 'hex') FROM unnest(prev_refresh_hashes) WITH ORDINALITY AS t(h, n) ORDER BY n)
    AS prev_refresh_hashes,
  rotated_at, idle_expires_at, absolute_expires_at, revoked_at, revoke_reason, amr, auth_time,
  host(ip) AS ip, user_agent, created_at, last_active_at, version`;

const HEX_ARRAY_TO_BYTEA = (param: string) =>
  `ARRAY(SELECT decode(h, 'hex') FROM unnest(${param}::text[]) WITH ORDINALITY AS t(h, n) ORDER BY n)`;

export class TypeOrmSessionRepository implements SessionRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tx: TransactionContext,
  ) {}

  async findById(id: SessionId): Promise<Session | undefined> {
    const manager = this.tx.active?.manager ?? this.dataSource.manager;
    const rows: SessionRow[] = await manager.query(
      `SELECT ${SELECT_COLUMNS} FROM sessions WHERE id = $1`,
      [id],
    );
    const row = first(rows);
    return row ? toSession(row) : undefined;
  }

  async save(session: Session): Promise<void> {
    const manager = this.tx.requireManager();
    if (session.version === 0) {
      await this.insert(manager, session);
    } else {
      await this.update(manager, session);
    }
    session.markPersisted();
    this.tx.track(session);
  }

  private async insert(
    manager: EntityManager,
    session: Session,
  ): Promise<void> {
    const s = session.snapshot;
    await manager.query(
      `INSERT INTO sessions (id, user_id, refresh_hash, prev_refresh_hashes, rotated_at, idle_expires_at,
         absolute_expires_at, revoked_at, revoke_reason, amr, auth_time, ip, user_agent, created_at,
         last_active_at, version)
       VALUES ($1, $2, decode($3, 'hex'), ${HEX_ARRAY_TO_BYTEA('$4')}, $5, $6, $7, $8, $9, $10, $11,
         $12, $13, $14, $15, 1)`,
      [
        session.id,
        s.userId,
        s.refreshHash,
        s.prevRefreshHashes,
        s.rotatedAt,
        s.idleExpiresAt,
        s.absoluteExpiresAt,
        s.revokedAt,
        s.revokeReason,
        s.amr,
        s.authTime,
        s.ip,
        s.userAgent,
        s.createdAt,
        s.lastActiveAt,
      ],
    );
  }

  /** Rotation is one HOT update (no indexed column changes); version guards concurrent refreshes. */
  private async update(
    manager: EntityManager,
    session: Session,
  ): Promise<void> {
    const s = session.snapshot;
    const [, affected]: [unknown, number] = await manager.query(
      `UPDATE sessions SET refresh_hash = decode($3, 'hex'), prev_refresh_hashes = ${HEX_ARRAY_TO_BYTEA('$4')},
         rotated_at = $5, idle_expires_at = $6, revoked_at = $7, revoke_reason = $8, ip = $9,
         user_agent = $10, last_active_at = $11, version = version + 1
       WHERE id = $1 AND version = $2`,
      [
        session.id,
        session.version,
        s.refreshHash,
        s.prevRefreshHashes,
        s.rotatedAt,
        s.idleExpiresAt,
        s.revokedAt,
        s.revokeReason,
        s.ip,
        s.userAgent,
        s.lastActiveAt,
      ],
    );
    if (affected !== 1)
      throw new ConcurrencyConflictError('Session', session.id);
  }
}

function toSession(row: SessionRow): Session {
  return Session.reconstitute(
    row.id as SessionId, // trusted boundary: ids we generated
    {
      userId: row.user_id,
      refreshHash: row.refresh_hash,
      prevRefreshHashes: row.prev_refresh_hashes,
      rotatedAt: row.rotated_at,
      idleExpiresAt: row.idle_expires_at,
      absoluteExpiresAt: row.absolute_expires_at,
      revokedAt: row.revoked_at,
      revokeReason: row.revoke_reason,
      amr: row.amr,
      authTime: row.auth_time,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    },
    row.version,
  );
}
