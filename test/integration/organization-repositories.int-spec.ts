import { randomUUIDv7 } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SYSTEM_ROLES } from '../../src/contracts/permissions.js';
import {
  type SystemRoleIds,
  syncPermissionCatalog,
} from '../../src/modules/access-control/infrastructure/catalog-sync.js';
import {
  Membership,
  type RoleId,
} from '../../src/modules/organization/domain/membership.js';
import { SlugTakenError } from '../../src/modules/organization/domain/organization.errors.js';
import { Organization } from '../../src/modules/organization/domain/organization.js';
import { Slug } from '../../src/modules/organization/domain/slug.js';
import { OrganizationQueries } from '../../src/modules/organization/infrastructure/organization-queries.js';
import { TypeOrmMembershipRepository } from '../../src/modules/organization/infrastructure/typeorm-membership.repository.js';
import { TypeOrmOrganizationRepository } from '../../src/modules/organization/infrastructure/typeorm-organization.repository.js';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../src/shared/application/ports.js';
import { ok } from '../../src/shared/domain/result.js';
import { TransactionContext } from '../../src/shared/infrastructure/persistence/transaction-context.js';
import { createPersistenceApp } from './support/persistence-app.js';

const now = new Date('2026-11-27T12:00:00Z');

describe('organization persistence (integration)', () => {
  let moduleRef: TestingModule;
  let db: DataSource;
  let uow: UnitOfWork;
  let orgs: TypeOrmOrganizationRepository;
  let memberships: TypeOrmMembershipRepository;
  let queries: OrganizationQueries;
  let roles: SystemRoleIds;

  async function newUser(): Promise<string> {
    const id = randomUUIDv7();
    await db.query('INSERT INTO users (id, email) VALUES ($1, $2)', [
      id,
      `${id}@test.local`,
    ]);
    return id;
  }

  async function createOrgWithOwner(slug = `org-${randomUUIDv7().slice(-12)}`) {
    const parsed = Slug.create(slug);
    if (!parsed.ok) throw parsed.error;
    const org = Organization.create({ name: 'Acme', slug: parsed.value, now });
    const userId = await newUser();
    const owner = Membership.createOwner({
      orgId: org.id,
      userId,
      ownerRoleId: roles.owner as RoleId,
      now,
    });
    await uow.run(async () => {
      await orgs.save(org);
      await memberships.save(owner);
      return ok(undefined);
    });
    return { org, owner, userId };
  }

  beforeAll(async () => {
    moduleRef = await createPersistenceApp();
    db = moduleRef.get(DataSource);
    uow = moduleRef.get<UnitOfWork>(UNIT_OF_WORK);
    const tx = moduleRef.get(TransactionContext);
    orgs = new TypeOrmOrganizationRepository(db, tx);
    memberships = new TypeOrmMembershipRepository(db, tx);
    queries = new OrganizationQueries(db);
    roles = await db.transaction((manager) => syncPermissionCatalog(manager));
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('org + owner membership round-trip', async () => {
    const { org, owner, userId } = await createOrgWithOwner();

    const loadedOrg = await orgs.findById(org.id);
    const loadedMembership = await memberships.findByOrgAndUser(org.id, userId);

    expect(loadedOrg?.snapshot).toEqual(org.snapshot);
    expect(loadedMembership?.id).toBe(owner.id);
    expect(loadedMembership?.roles.items).toEqual([roles.owner]);
    expect(loadedMembership?.roles.added).toEqual([]);
  });

  it('duplicate slug → SlugTakenError', async () => {
    const slug = `dup-${randomUUIDv7().slice(-12)}`;
    await createOrgWithOwner(slug);

    await expect(createOrgWithOwner(slug)).rejects.toBeInstanceOf(
      SlugTakenError,
    );
  });

  it('membershipContext unions role permissions; suspended membership → undefined', async () => {
    const { org, owner, userId } = await createOrgWithOwner();

    const context = await queries.membershipContext(userId, org.id);

    expect(context).toMatchObject({
      membershipId: owner.id,
      authzVersion: 0,
      authzEpoch: 0,
      mfaRequired: false,
    });
    expect([...(context?.permissions ?? [])].sort()).toEqual(
      [...SYSTEM_ROLES.owner].sort(),
    );

    await db.query(
      `UPDATE memberships SET status = 'suspended' WHERE id = $1`,
      [owner.id],
    );
    expect(await queries.membershipContext(userId, org.id)).toBeUndefined();
  });

  it('activeMembershipsOf lists orgs with role keys; membersOf lists members', async () => {
    const { org, userId } = await createOrgWithOwner();

    expect(await queries.activeMembershipsOf(userId)).toEqual([
      {
        orgId: org.id,
        slug: org.snapshot.slug.value,
        name: 'Acme',
        roleKeys: ['owner'],
      },
    ]);
    expect(await queries.membersOf(org.id)).toEqual([
      expect.objectContaining({
        userId,
        status: 'active',
        roleKeys: ['owner'],
      }),
    ]);
  });
});
