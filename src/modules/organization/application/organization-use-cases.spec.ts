import {
  decodePermissionBits,
  hasPermission,
} from '#src/sdk/permission-bits.js';
import { permissionCatalog, SYSTEM_ROLES } from '#src/contracts/permissions.js';
import { CreateOrganizationUseCase } from './create-organization.use-case.js';
import { ListMembersUseCase } from './list-members.use-case.js';
import {
  FakeDirectory,
  FakeReads,
  fixedClock,
  InMemoryMemberships,
  InMemoryOrganizations,
  passthroughUow,
  systemRoles,
} from './organization.test-support.js';
import { ResolveOrgContextUseCase } from './resolve-org-context.use-case.js';

function createSetup() {
  const orgs = new InMemoryOrganizations();
  const memberships = new InMemoryMemberships();
  const directory = new FakeDirectory();
  directory.verified.add('u1');
  const useCase = new CreateOrganizationUseCase(
    directory,
    orgs,
    memberships,
    systemRoles,
    passthroughUow,
    fixedClock,
  );
  return { orgs, memberships, directory, useCase };
}

describe('CreateOrganizationUseCase', () => {
  it('requires a verified email', async () => {
    const { useCase } = createSetup();

    expect(
      await useCase.execute({ userId: 'u2', name: 'Acme', slug: 'acme' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.EMAIL_NOT_VERIFIED' },
    });
  });

  it('creates the org and an owner membership', async () => {
    const { orgs, memberships, useCase } = createSetup();

    const result = await useCase.execute({
      userId: 'u1',
      name: 'Acme',
      slug: 'Acme',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(orgs.rows.get(result.value.orgId)?.snapshot.slug.value).toBe('acme');
    expect(memberships.rows).toEqual([
      expect.objectContaining({
        orgId: result.value.orgId,
        userId: 'u1',
        isActive: true,
      }),
    ]);
    expect(memberships.rows[0]?.roles.items).toEqual(['role-owner']);
  });

  it('slug taken and invalid slug pass through as errors', async () => {
    const { useCase } = createSetup();
    await useCase.execute({ userId: 'u1', name: 'Acme', slug: 'acme' });

    expect(
      await useCase.execute({ userId: 'u1', name: 'Again', slug: 'acme' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.SLUG_TAKEN' },
    });
    expect(
      await useCase.execute({ userId: 'u1', name: 'Bad', slug: '-x' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.INVALID_SLUG' },
    });
  });
});

describe('ResolveOrgContextUseCase', () => {
  const ownerContext = {
    membershipId: 'm1',
    authzVersion: 3,
    authzEpoch: 2,
    mfaRequired: false,
    permissions: SYSTEM_ROLES.owner,
  };

  it('encodes the effective permissions into pbits', async () => {
    const reads = new FakeReads();
    reads.contexts.set('u1:org-1', ownerContext);

    const context = await new ResolveOrgContextUseCase(reads).contextFor(
      'u1',
      'org-1',
    );

    expect(context).toMatchObject({
      orgId: 'org-1',
      membershipId: 'm1',
      mv: 3,
      ov: 2,
      pcv: 1,
      mfaRequired: false,
    });
    const bits = decodePermissionBits(context?.pbits ?? '');
    for (const code of SYSTEM_ROLES.owner)
      expect(hasPermission(permissionCatalog(), bits, code)).toBe(true);
  });

  it('default org: preferred active > single membership > none', async () => {
    const reads = new FakeReads();
    const resolve = new ResolveOrgContextUseCase(reads);
    reads.contexts.set('u1:org-1', ownerContext);
    reads.contexts.set('u1:org-2', { ...ownerContext, membershipId: 'm2' });
    reads.memberships = [
      { orgId: 'org-1', slug: 'a', name: 'A', roleKeys: ['owner'] },
      { orgId: 'org-2', slug: 'b', name: 'B', roleKeys: ['owner'] },
    ];

    expect((await resolve.defaultFor('u1', 'org-2'))?.orgId).toBe('org-2');
    expect(await resolve.defaultFor('u1', 'org-gone')).toBeUndefined();

    reads.memberships = [
      { orgId: 'org-1', slug: 'a', name: 'A', roleKeys: ['owner'] },
    ];
    expect((await resolve.defaultFor('u1', null))?.orgId).toBe('org-1');
  });
});

describe('ListMembersUseCase', () => {
  it('includes emails from the identity directory', async () => {
    const reads = new FakeReads();
    reads.members = [
      {
        membershipId: 'm1',
        userId: 'u1',
        status: 'active',
        roleKeys: ['owner'],
      },
    ];
    const directory = new FakeDirectory();
    directory.emails.set('u1', 'a@b.co');

    expect(
      await new ListMembersUseCase(reads, directory).execute({
        orgId: 'org-1',
      }),
    ).toEqual([
      {
        membershipId: 'm1',
        userId: 'u1',
        email: 'a@b.co',
        status: 'active',
        roles: ['owner'],
      },
    ]);
  });
});
