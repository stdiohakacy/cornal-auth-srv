import { randomUUIDv7 } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  type SystemRoleIds,
  syncPermissionCatalog,
} from '../../src/modules/access-control/infrastructure/catalog-sync.js';
import {
  Membership,
  type RoleId,
} from '../../src/modules/organization/domain/membership.js';
import {
  RoleInUseError,
  RoleKeyTakenError,
} from '../../src/modules/organization/domain/organization.errors.js';
import { Organization } from '../../src/modules/organization/domain/organization.js';
import { Role, RoleKey } from '../../src/modules/organization/domain/role.js';
import { Slug } from '../../src/modules/organization/domain/slug.js';
import { OrganizationQueries } from '../../src/modules/organization/infrastructure/organization-queries.js';
import { TypeOrmMembershipRepository } from '../../src/modules/organization/infrastructure/typeorm-membership.repository.js';
import { TypeOrmOrganizationRepository } from '../../src/modules/organization/infrastructure/typeorm-organization.repository.js';
import { TypeOrmRoleRepository } from '../../src/modules/organization/infrastructure/typeorm-role.repository.js';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../src/shared/application/ports.js';
import { ConcurrencyConflictError } from '../../src/shared/domain/concurrency-conflict.error.js';
import { ok } from '../../src/shared/domain/result.js';
import { TransactionContext } from '../../src/shared/infrastructure/persistence/transaction-context.js';
import { createPersistenceApp } from './support/persistence-app.js';

const now = new Date('2026-11-27T12:00:00Z');

describe('organization roles & member management persistence (integration)', () => {
  let moduleRef: TestingModule;
  let db: DataSource;
  let uow: UnitOfWork;
  let orgs: TypeOrmOrganizationRepository;
  let memberships: TypeOrmMembershipRepository;
  let roleRepo: TypeOrmRoleRepository;
  let queries: OrganizationQueries;
  let system: SystemRoleIds;

  const inTx = <T>(work: () => Promise<T>) =>
    uow
      .run(async () => ok(await work()))
      .then((r) => (r.ok ? r.value : Promise.reject(r.error)));

  async function newUser(): Promise<string> {
    const id = randomUUIDv7();
    await db.query('INSERT INTO users (id, email) VALUES ($1, $2)', [
      id,
      `${id}@test.local`,
    ]);
    return id;
  }

  async function newOrg() {
    const slug = Slug.create(`r-${randomUUIDv7().slice(-12)}`);
    if (!slug.ok) throw slug.error;
    const org = Organization.create({ name: 'Acme', slug: slug.value, now });
    const owner = Membership.createOwner({
      orgId: org.id,
      userId: await newUser(),
      ownerRoleId: system.owner as RoleId,
      now,
    });
    await inTx(async () => {
      await orgs.save(org);
      await memberships.save(owner);
    });
    return { org, owner };
  }

  function key(raw: string) {
    const parsed = RoleKey.create(raw);
    if (!parsed.ok) throw parsed.error;
    return parsed.value;
  }

  beforeAll(async () => {
    moduleRef = await createPersistenceApp();
    db = moduleRef.get(DataSource);
    uow = moduleRef.get<UnitOfWork>(UNIT_OF_WORK);
    const tx = moduleRef.get(TransactionContext);
    orgs = new TypeOrmOrganizationRepository(db, tx);
    memberships = new TypeOrmMembershipRepository(db, tx);
    roleRepo = new TypeOrmRoleRepository(db, tx);
    queries = new OrganizationQueries(db);
    system = await db.transaction((manager) => syncPermissionCatalog(manager));
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('role save/find round-trip with permissions; foreign org → undefined', async () => {
    const { org } = await newOrg();
    const other = await newOrg();
    const role = Role.create({
      orgId: org.id,
      key: key('viewer'),
      name: 'Viewer',
      permissions: ['org:read'],
      now,
    });
    await inTx(() => roleRepo.save(role));

    const loaded = await roleRepo.findInOrg(org.id, role.id);
    expect(loaded?.permissions.items).toEqual(['org:read']);
    expect(await roleRepo.findInOrg(other.org.id, role.id)).toBeUndefined();
    expect(
      await roleRepo.findInOrg(org.id, system.admin as RoleId),
    ).toBeUndefined();

    if (!loaded) return;
    loaded.rename('Viewer 2');
    loaded.setPermissions(['member:read', 'role:read']);
    await inTx(() => roleRepo.save(loaded));
    const [view] = await queries.rolesByIds(org.id, [role.id]);
    expect(view).toEqual({
      id: role.id,
      key: 'viewer',
      name: 'Viewer 2',
      system: false,
      permissions: ['member:read', 'role:read'],
    });
  });

  it('duplicate key in the same org → RoleKeyTakenError; same key in another org ok', async () => {
    const a = await newOrg();
    const b = await newOrg();
    const make = (orgId: string) =>
      Role.create({
        orgId,
        key: key('ops'),
        name: 'Ops',
        permissions: [],
        now,
      });
    await inTx(() => roleRepo.save(make(a.org.id)));

    await expect(
      inTx(() => roleRepo.save(make(a.org.id))),
    ).rejects.toBeInstanceOf(RoleKeyTakenError);
    await expect(
      inTx(() => roleRepo.save(make(b.org.id))),
    ).resolves.toBeUndefined();
  });

  it('delete an assigned role → RoleInUseError; unassigned → gone', async () => {
    const { org, owner } = await newOrg();
    const used = Role.create({
      orgId: org.id,
      key: key('used'),
      name: 'Used',
      permissions: [],
      now,
    });
    const unused = Role.create({
      orgId: org.id,
      key: key('unused'),
      name: 'Unused',
      permissions: [],
      now,
    });
    await inTx(async () => {
      await roleRepo.save(used);
      await roleRepo.save(unused);
    });
    const loadedOwner = await memberships.findById(owner.id);
    if (!loadedOwner) throw new Error('owner missing');
    loadedOwner.replaceRoles([system.owner as RoleId, used.id]);
    await inTx(() => memberships.save(loadedOwner));

    await expect(inTx(() => roleRepo.delete(used))).rejects.toBeInstanceOf(
      RoleInUseError,
    );
    await inTx(() => roleRepo.delete(unused));
    expect(await roleRepo.findInOrg(org.id, unused.id)).toBeUndefined();
  });

  it('rolesOf lists system roles first, then custom; rolesByIds filters out another org', async () => {
    const a = await newOrg();
    const b = await newOrg();
    const foreign = Role.create({
      orgId: b.org.id,
      key: key('foreign'),
      name: 'F',
      permissions: [],
      now,
    });
    const mine = Role.create({
      orgId: a.org.id,
      key: key('mine'),
      name: 'M',
      permissions: ['org:read'],
      now,
    });
    await inTx(async () => {
      await roleRepo.save(foreign);
      await roleRepo.save(mine);
    });

    expect(
      (await queries.rolesOf(a.org.id)).map((r) => [r.key, r.system]),
    ).toEqual([
      ['admin', true],
      ['member', true],
      ['owner', true],
      ['mine', false],
    ]);
    const found = await queries.rolesByIds(a.org.id, [
      foreign.id,
      mine.id,
      system.member,
    ]);
    expect(found.map((r) => r.id).sort()).toEqual(
      [mine.id, system.member].sort(),
    );
  });

  it('activeOwnerCount ignores suspended owners', async () => {
    const { org } = await newOrg();
    const second = Membership.createOwner({
      orgId: org.id,
      userId: await newUser(),
      ownerRoleId: system.owner as RoleId,
      now,
    });
    await inTx(() => memberships.save(second));
    expect(await queries.activeOwnerCount(org.id)).toBe(2);

    const loaded = await memberships.findById(second.id);
    if (!loaded) throw new Error('missing');
    loaded.suspend();
    await inTx(() => memberships.save(loaded));

    expect(await queries.activeOwnerCount(org.id)).toBe(1);
  });

  it('membership findById + delete; stale version → ConcurrencyConflictError', async () => {
    const { org } = await newOrg();
    const m = Membership.createMember({
      orgId: org.id,
      userId: await newUser(),
      roleIds: [system.member as RoleId],
      now,
    });
    await inTx(() => memberships.save(m));
    const first = await memberships.findById(m.id);
    const stale = await memberships.findById(m.id);
    if (!first || !stale) throw new Error('missing');
    first.suspend();
    await inTx(() => memberships.save(first));

    await expect(inTx(() => memberships.delete(stale))).rejects.toBeInstanceOf(
      ConcurrencyConflictError,
    );
    const fresh = await memberships.findById(m.id);
    if (!fresh) throw new Error('missing');
    await inTx(() => memberships.delete(fresh));
    expect(await memberships.findById(m.id)).toBeUndefined();
  });
});
