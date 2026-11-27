import type { DataSource } from 'typeorm';
import { first } from '#src/shared/domain/guard.js';
import { TransactionContext } from '#src/shared/infrastructure/persistence/transaction-context.js';
import type {
  OneTimeTokenRepository,
  OpenOrgInvite,
  OrgInvitePayload,
  TokenPurpose,
} from '../application/ports.js';
import type { UserId } from '../domain/user.js';

export class TypeOrmOneTimeTokenRepository implements OneTimeTokenRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tx: TransactionContext,
  ) {}

  async issue(input: {
    purpose: TokenPurpose;
    userId: UserId;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.tx.requireManager().query(
      `INSERT INTO one_time_tokens (token_hash, purpose, user_id, expires_at)
         VALUES (decode($1, 'hex'), $2, $3, $4)`,
      [input.tokenHash, input.purpose, input.userId, input.expiresAt],
    );
  }

  async revokeOpen(userId: UserId, purpose: TokenPurpose): Promise<void> {
    await this.tx.requireManager().query(
      `UPDATE one_time_tokens SET consumed_at = now()
         WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [userId, purpose],
    );
  }

  async findValid(
    purpose: TokenPurpose,
    tokenHash: string,
    now: Date,
  ): Promise<{ userId: UserId } | undefined> {
    const manager = this.tx.active?.manager ?? this.dataSource.manager;
    const rows: { user_id: string }[] = await manager.query(
      `SELECT user_id FROM one_time_tokens
       WHERE token_hash = decode($1, 'hex') AND purpose = $2
         AND consumed_at IS NULL AND expires_at > $3`,
      [tokenHash, purpose, now],
    );
    const row = first(rows);
    return row ? { userId: row.user_id as UserId } : undefined;
  }

  async consume(
    purpose: TokenPurpose,
    tokenHash: string,
    now: Date,
  ): Promise<{ userId: UserId } | undefined> {
    const [rows]: [{ user_id: string }[], number] = await this.tx
      .requireManager()
      .query(
        `UPDATE one_time_tokens SET consumed_at = $3
         WHERE token_hash = decode($1, 'hex') AND purpose = $2
           AND consumed_at IS NULL AND expires_at > $3
         RETURNING user_id`,
        [tokenHash, purpose, now],
      );
    const row = first(rows);
    return row ? { userId: row.user_id as UserId } : undefined;
  }

  async issueOrgInvite(input: {
    tokenHash: string;
    payload: OrgInvitePayload;
    expiresAt: Date;
  }): Promise<void> {
    await this.tx.requireManager().query(
      `INSERT INTO one_time_tokens (token_hash, purpose, user_id, payload, expires_at)
       VALUES (decode($1, 'hex'), 'org_invite', NULL, $2::jsonb, $3)`,
      [input.tokenHash, JSON.stringify(input.payload), input.expiresAt],
    );
  }

  async revokeOpenOrgInvites(orgId: string, email: string): Promise<void> {
    await this.tx.requireManager().query(
      `UPDATE one_time_tokens SET consumed_at = now()
       WHERE purpose = 'org_invite' AND consumed_at IS NULL
         AND payload->>'orgId' = $1 AND lower(payload->>'email') = lower($2)`,
      [orgId, email],
    );
  }

  async consumeOrgInvite(
    tokenHash: string,
    email: string,
    now: Date,
  ): Promise<OrgInvitePayload | undefined> {
    const [rows]: [{ payload: OrgInvitePayload }[], number] = await this.tx
      .requireManager()
      .query(
        `UPDATE one_time_tokens SET consumed_at = $3
       WHERE token_hash = decode($1, 'hex') AND purpose = 'org_invite'
         AND consumed_at IS NULL AND expires_at > $3
         AND lower(payload->>'email') = lower($2)
       RETURNING payload`,
        [tokenHash, email, now],
      );
    return first(rows)?.payload;
  }

  async listOpenOrgInvites(orgId: string, now: Date): Promise<OpenOrgInvite[]> {
    const manager = this.tx.active?.manager ?? this.dataSource.manager;
    const rows: {
      payload: OrgInvitePayload;
      expires_at: Date;
      created_at: Date;
    }[] = await manager.query(
      `SELECT payload, expires_at, created_at FROM one_time_tokens
       WHERE purpose = 'org_invite' AND consumed_at IS NULL AND expires_at > $2
         AND payload->>'orgId' = $1
       ORDER BY created_at, token_hash`,
      [orgId, now],
    );
    return rows.map((row) => ({
      ...row.payload,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
  }

  async revokeOrgInvite(orgId: string, invitationId: string): Promise<boolean> {
    const [, affected]: [unknown, number] = await this.tx
      .requireManager()
      .query(
        `UPDATE one_time_tokens SET consumed_at = now()
       WHERE purpose = 'org_invite' AND consumed_at IS NULL
         AND payload->>'orgId' = $1 AND payload->>'invitationId' = $2`,
        [orgId, invitationId],
      );
    return affected > 0;
  }
}
