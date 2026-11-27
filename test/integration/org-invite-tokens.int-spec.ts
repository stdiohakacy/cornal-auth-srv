import { randomUUIDv7 } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import type { OrgInvitePayload } from '../../src/modules/identity/application/ports.js';
import { TypeOrmOneTimeTokenRepository } from '../../src/modules/identity/infrastructure/typeorm-one-time-token.repository.js';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../src/shared/application/ports.js';
import { ok } from '../../src/shared/domain/result.js';
import { TransactionContext } from '../../src/shared/infrastructure/persistence/transaction-context.js';
import { createPersistenceApp } from './support/persistence-app.js';

describe('organization invite tokens (integration)', () => {
  let moduleRef: TestingModule;
  let db: DataSource;
  let uow: UnitOfWork;
  let tokens: TypeOrmOneTimeTokenRepository;
  const now = new Date();
  const later = new Date(now.getTime() + 60_000);

  const inTx = <T>(work: () => Promise<T>) =>
    uow
      .run(async () => ok(await work()))
      .then((r) => (r.ok ? r.value : Promise.reject(r.error)));

  const payload = (orgId: string, email = 'New@B.co'): OrgInvitePayload => ({
    invitationId: randomUUIDv7(),
    orgId,
    email,
    roleIds: [randomUUIDv7()],
    invitedBy: randomUUIDv7(),
  });
  const hash = () => randomUUIDv7().replaceAll('-', '').padEnd(64, '0');

  beforeAll(async () => {
    moduleRef = await createPersistenceApp();
    db = moduleRef.get(DataSource);
    uow = moduleRef.get<UnitOfWork>(UNIT_OF_WORK);
    tokens = new TypeOrmOneTimeTokenRepository(
      db,
      moduleRef.get(TransactionContext),
    );
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('migration created the partial index', async () => {
    const rows: unknown[] = await db.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'one_time_tokens_org_invite_idx'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('list shows only open, unexpired invites of that org', async () => {
    const orgId = randomUUIDv7();
    const open = payload(orgId);
    await inTx(async () => {
      await tokens.issueOrgInvite({
        tokenHash: hash(),
        payload: open,
        expiresAt: later,
      });
      await tokens.issueOrgInvite({
        tokenHash: hash(),
        payload: payload(orgId),
        expiresAt: new Date(now.getTime() - 1),
      });
      await tokens.issueOrgInvite({
        tokenHash: hash(),
        payload: payload(randomUUIDv7()),
        expiresAt: later,
      });
    });

    const listed = await tokens.listOpenOrgInvites(orgId, now);

    expect(listed).toEqual([
      expect.objectContaining({ ...open, expiresAt: later }),
    ]);
  });

  it('revoke → removed from the list; unknown id → false', async () => {
    const orgId = randomUUIDv7();
    const invite = payload(orgId);
    await inTx(() =>
      tokens.issueOrgInvite({
        tokenHash: hash(),
        payload: invite,
        expiresAt: later,
      }),
    );

    expect(
      await inTx(() => tokens.revokeOrgInvite(orgId, randomUUIDv7())),
    ).toBe(false);
    expect(
      await inTx(() => tokens.revokeOrgInvite(orgId, invite.invitationId)),
    ).toBe(true);
    expect(await tokens.listOpenOrgInvites(orgId, now)).toEqual([]);
  });

  it('consume is atomic and case-insensitive on email; other email consumes nothing', async () => {
    const orgId = randomUUIDv7();
    const invite = payload(orgId, 'New@B.co');
    const tokenHash = hash();
    await inTx(() =>
      tokens.issueOrgInvite({ tokenHash, payload: invite, expiresAt: later }),
    );

    expect(
      await inTx(() => tokens.consumeOrgInvite(tokenHash, 'other@b.co', now)),
    ).toBeUndefined();
    const results = await Promise.all([
      inTx(() => tokens.consumeOrgInvite(tokenHash, 'new@b.co', now)),
      inTx(() => tokens.consumeOrgInvite(tokenHash, 'NEW@b.co', now)),
    ]);
    expect(results.filter((r) => r !== undefined)).toEqual([invite]);
  });

  it('revokeOpenOrgInvites closes the previous invite for (org, email) regardless of case', async () => {
    const orgId = randomUUIDv7();
    await inTx(() =>
      tokens.issueOrgInvite({
        tokenHash: hash(),
        payload: payload(orgId, 'a@b.co'),
        expiresAt: later,
      }),
    );

    await inTx(() => tokens.revokeOpenOrgInvites(orgId, 'A@B.CO'));

    expect(await tokens.listOpenOrgInvites(orgId, now)).toEqual([]);
  });
});
