import { SYSTEM_ROLES } from '../../../contracts/permissions.js';
import { Membership, type RoleId } from '../domain/membership.js';
import { Organization } from '../domain/organization.js';
import { Slug } from '../domain/slug.js';
import { AcceptInvitationUseCase } from './accept-invitation.use-case.js';
import { CreateRoleUseCase } from './create-role.use-case.js';
import { DeleteRoleUseCase } from './delete-role.use-case.js';
import { InviteMemberUseCase } from './invite-member.use-case.js';
import {
  FakeInvitationGateway,
  FakeReads,
  fixedClock,
  InMemoryInvitations,
  InMemoryMemberships,
  InMemoryOrganizations,
  InMemoryRoles,
  NOW,
  passthroughUow,
  systemRoles,
} from './organization.test-support.js';
import { RemoveMemberUseCase } from './remove-member.use-case.js';
import { RevokeInvitationUseCase } from './revoke-invitation.use-case.js';
import { UpdateMemberUseCase } from './update-member.use-case.js';
import { UpdateRoleUseCase } from './update-role.use-case.js';

const r = (id: string) => id as RoleId;

/** One org with an owner (u-owner), an admin (u-admin) and a plain member (u-member). */
function world() {
  const slug = Slug.create('acme');
  if (!slug.ok) throw slug.error;
  const org = Organization.create({ name: 'Acme', slug: slug.value, now: NOW });
  const orgs = new InMemoryOrganizations();
  void orgs.save(org);
  const memberships = new InMemoryMemberships();
  const reads = new FakeReads();
  reads.ownerSource = memberships;
  const add = (userId: string, roleId: string, perms: readonly string[]) => {
    const m = Membership.createMember({
      orgId: org.id,
      userId,
      roleIds: [r(roleId)],
      now: NOW,
    });
    m.markPersisted();
    memberships.rows.push(m);
    reads.contexts.set(`${userId}:${org.id}`, {
      membershipId: m.id,
      authzVersion: 0,
      authzEpoch: 0,
      mfaRequired: false,
      permissions: perms,
    });
    return m;
  };
  const owner = add('u-owner', 'role-owner', SYSTEM_ROLES.owner);
  const admin = add('u-admin', 'role-admin', SYSTEM_ROLES.admin);
  const member = add('u-member', 'role-member', SYSTEM_ROLES.member);
  const updateMember = new UpdateMemberUseCase(
    reads,
    memberships,
    systemRoles,
    passthroughUow,
  );
  const removeMember = new RemoveMemberUseCase(
    reads,
    memberships,
    systemRoles,
    passthroughUow,
  );
  return {
    org,
    orgs,
    memberships,
    reads,
    owner,
    admin,
    member,
    updateMember,
    removeMember,
  };
}

describe('member management', () => {
  it('admin cannot grant owner, nor suspend an owner; owner can grant admin', async () => {
    const w = world();
    const base = { orgId: w.org.id };

    expect(
      await w.updateMember.execute({
        ...base,
        actorUserId: 'u-admin',
        membershipId: w.member.id,
        roleIds: ['role-owner'],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.INSUFFICIENT_PRIVILEGE' },
    });
    expect(
      await w.updateMember.execute({
        ...base,
        actorUserId: 'u-admin',
        membershipId: w.owner.id,
        status: 'suspended',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.INSUFFICIENT_PRIVILEGE' },
    });
    expect(
      await w.updateMember.execute({
        ...base,
        actorUserId: 'u-owner',
        membershipId: w.member.id,
        roleIds: ['role-admin'],
      }),
    ).toEqual({ ok: true, value: undefined });
    expect(w.member.roles.items).toEqual(['role-admin']);
    expect(w.member.authzVersion).toBe(1);
  });

  it('a member without permissions in the org → INSUFFICIENT_PRIVILEGE', async () => {
    const w = world();

    expect(
      await w.removeMember.execute({
        orgId: w.org.id,
        actorUserId: 'u-stranger',
        membershipId: w.member.id,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.INSUFFICIENT_PRIVILEGE' },
    });
  });

  it('sole owner demoting/suspending/removing self → LAST_OWNER; with a second owner → ok', async () => {
    const w = world();
    const self = {
      orgId: w.org.id,
      actorUserId: 'u-owner',
      membershipId: w.owner.id,
    };

    for (const result of [
      await w.updateMember.execute({ ...self, roleIds: ['role-admin'] }),
      await w.updateMember.execute({ ...self, status: 'suspended' }),
      await w.removeMember.execute(self),
    ]) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'ORG.LAST_OWNER' },
      });
    }

    await w.updateMember.execute({
      ...self,
      membershipId: w.admin.id,
      roleIds: ['role-owner'],
    });
    expect(
      await w.updateMember.execute({ ...self, status: 'suspended' }),
    ).toEqual({ ok: true, value: undefined });
  });

  it('role id of another org → ROLE_NOT_FOUND; unknown member → MEMBER_NOT_FOUND', async () => {
    const w = world();
    w.reads.roles.push({
      id: 'role-foreign',
      key: 'x',
      name: 'X',
      system: false,
      orgId: 'org-other',
      permissions: [],
    });
    const base = { orgId: w.org.id, actorUserId: 'u-owner' };

    expect(
      await w.updateMember.execute({
        ...base,
        membershipId: w.member.id,
        roleIds: ['role-foreign'],
      }),
    ).toMatchObject({ ok: false, error: { code: 'ORG.ROLE_NOT_FOUND' } });
    expect(
      await w.updateMember.execute({
        ...base,
        membershipId: 'nope',
        status: 'suspended',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.MEMBER_NOT_FOUND' },
    });
  });

  it('same roles → nothing saved; remove deletes the membership', async () => {
    const w = world();
    const savesBefore = w.memberships.saves;
    const base = {
      orgId: w.org.id,
      actorUserId: 'u-owner',
      membershipId: w.member.id,
    };

    expect(
      await w.updateMember.execute({ ...base, roleIds: ['role-member'] }),
    ).toEqual({ ok: true, value: undefined });
    expect(w.memberships.saves).toBe(savesBefore);
    expect(await w.removeMember.execute(base)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(w.memberships.rows).not.toContain(w.member);
  });
});

describe('custom roles', () => {
  function setup() {
    const w = world();
    const roles = new InMemoryRoles();
    return {
      ...w,
      roles,
      create: new CreateRoleUseCase(w.reads, roles, passthroughUow, fixedClock),
      update: new UpdateRoleUseCase(w.reads, roles, w.orgs, passthroughUow),
      remove: new DeleteRoleUseCase(w.reads, roles, passthroughUow),
    };
  }

  it('create with a permission the actor lacks → INSUFFICIENT_PRIVILEGE; bad key → INVALID_ROLE_KEY', async () => {
    const s = setup();

    expect(
      await s.create.execute({
        actorUserId: 'u-admin',
        orgId: s.org.id,
        key: 'boss',
        name: 'Boss',
        permissions: ['org:manage'],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.INSUFFICIENT_PRIVILEGE' },
    });
    expect(
      await s.create.execute({
        actorUserId: 'u-owner',
        orgId: s.org.id,
        key: 'owner',
        name: 'X',
        permissions: [],
      }),
    ).toMatchObject({ ok: false, error: { code: 'ORG.INVALID_ROLE_KEY' } });
  });

  it('create → RoleView; duplicate key → ROLE_KEY_TAKEN', async () => {
    const s = setup();
    const input = {
      actorUserId: 'u-admin',
      orgId: s.org.id,
      key: 'viewer',
      name: 'Viewer',
      permissions: ['org:read' as const],
    };

    const created = await s.create.execute(input);

    expect(created).toMatchObject({
      ok: true,
      value: { key: 'viewer', system: false, permissions: ['org:read'] },
    });
    expect(await s.create.execute(input)).toMatchObject({
      ok: false,
      error: { code: 'ORG.ROLE_KEY_TAKEN' },
    });
  });

  it('update permissions bumps org authzEpoch; rename only does not; unknown → ROLE_NOT_FOUND', async () => {
    const s = setup();
    const created = await s.create.execute({
      actorUserId: 'u-owner',
      orgId: s.org.id,
      key: 'viewer',
      name: 'V',
      permissions: ['org:read'],
    });
    if (!created.ok) throw created.error;
    const base = {
      actorUserId: 'u-owner',
      orgId: s.org.id,
      roleId: created.value.id,
    };

    await s.update.execute({ ...base, name: 'Viewer' });
    expect(s.org.snapshot.authzEpoch).toBe(0);
    const updated = await s.update.execute({
      ...base,
      permissions: ['org:read', 'member:read'],
    });
    expect(updated).toMatchObject({
      ok: true,
      value: { name: 'Viewer', permissions: ['member:read', 'org:read'] },
    });
    expect(s.org.snapshot.authzEpoch).toBe(1);
    expect(
      await s.update.execute({ ...base, roleId: 'role-admin', name: 'x' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.ROLE_NOT_FOUND' },
    });
  });

  it('admin cannot edit a role holding permissions they lack', async () => {
    const s = setup();
    const created = await s.create.execute({
      actorUserId: 'u-owner',
      orgId: s.org.id,
      key: 'mgr',
      name: 'M',
      permissions: ['org:manage'],
    });
    if (!created.ok) throw created.error;

    expect(
      await s.update.execute({
        actorUserId: 'u-admin',
        orgId: s.org.id,
        roleId: created.value.id,
        permissions: [],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.INSUFFICIENT_PRIVILEGE' },
    });
  });

  it('delete role in use → ROLE_IN_USE; otherwise deleted', async () => {
    const s = setup();
    const created = await s.create.execute({
      actorUserId: 'u-owner',
      orgId: s.org.id,
      key: 'tmp',
      name: 'T',
      permissions: [],
    });
    if (!created.ok) throw created.error;
    const base = {
      actorUserId: 'u-owner',
      orgId: s.org.id,
      roleId: created.value.id,
    };
    s.roles.inUse.add(created.value.id);

    expect(await s.remove.execute(base)).toMatchObject({
      ok: false,
      error: { code: 'ORG.ROLE_IN_USE' },
    });
    s.roles.inUse.clear();
    expect(await s.remove.execute(base)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(s.roles.rows.size).toBe(0);
  });
});

describe('invitations', () => {
  function setup() {
    const w = world();
    const invitations = new InMemoryInvitations();
    const gateway = new FakeInvitationGateway();
    return {
      ...w,
      invitations,
      gateway,
      invite: new InviteMemberUseCase(
        w.reads,
        w.orgs,
        invitations,
        passthroughUow,
        fixedClock,
      ),
      accept: new AcceptInvitationUseCase(
        gateway,
        w.orgs,
        w.memberships,
        w.reads,
        systemRoles,
        passthroughUow,
        fixedClock,
      ),
      revoke: new RevokeInvitationUseCase(gateway),
    };
  }

  it('invite: unknown role → ROLE_NOT_FOUND; admin inviting as owner → INSUFFICIENT_PRIVILEGE', async () => {
    const s = setup();
    const base = { orgId: s.org.id, email: 'new@b.co' };

    expect(
      await s.invite.execute({
        ...base,
        actorUserId: 'u-owner',
        roleIds: ['nope'],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.ROLE_NOT_FOUND' },
    });
    expect(
      await s.invite.execute({
        ...base,
        actorUserId: 'u-admin',
        roleIds: ['role-owner'],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.INSUFFICIENT_PRIVILEGE' },
    });
  });

  it('invite ok → invitation event pending with the payload', async () => {
    const s = setup();

    const result = await s.invite.execute({
      orgId: s.org.id,
      actorUserId: 'u-admin',
      email: 'new@b.co',
      roleIds: ['role-member'],
    });

    expect(result.ok).toBe(true);
    expect(s.invitations.saved[0]?.pendingEvents[0]?.payload).toMatchObject({
      orgId: s.org.id,
      orgName: 'Acme',
      email: 'new@b.co',
      roleIds: ['role-member'],
      invitedBy: 'u-admin',
    });
  });

  it('accept: invalid token → INVITATION_INVALID; already member → ALREADY_MEMBER', async () => {
    const s = setup();

    expect(
      await s.accept.execute({ userId: 'u-new', token: 'bad' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.INVITATION_INVALID' },
    });
    s.gateway.payloads.set('t1', {
      invitationId: 'i1',
      orgId: s.org.id,
      email: 'x',
      roleIds: ['role-admin'],
      invitedBy: 'u-owner',
    });
    expect(
      await s.accept.execute({ userId: 'u-member', token: 't1' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.ALREADY_MEMBER' },
    });
  });

  it('accept: deleted roles dropped; none left → system member role', async () => {
    const s = setup();
    s.gateway.payloads.set('t1', {
      invitationId: 'i1',
      orgId: s.org.id,
      email: 'x',
      roleIds: ['role-gone'],
      invitedBy: 'u-owner',
    });
    s.gateway.payloads.set('t2', {
      invitationId: 'i2',
      orgId: s.org.id,
      email: 'y',
      roleIds: ['role-gone', 'role-admin'],
      invitedBy: 'u-owner',
    });

    expect(await s.accept.execute({ userId: 'u-a', token: 't1' })).toEqual({
      ok: true,
      value: { orgId: s.org.id },
    });
    expect(await s.accept.execute({ userId: 'u-b', token: 't2' })).toEqual({
      ok: true,
      value: { orgId: s.org.id },
    });

    const a = await s.memberships.findByOrgAndUser(s.org.id, 'u-a');
    const b = await s.memberships.findByOrgAndUser(s.org.id, 'u-b');
    expect(a?.roles.items).toEqual(['role-member']);
    expect(b?.roles.items).toEqual(['role-admin']);
  });

  it('revoke unknown invitation → INVITATION_NOT_FOUND', async () => {
    const s = setup();

    expect(
      await s.revoke.execute({ orgId: s.org.id, invitationId: 'nope' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ORG.INVITATION_NOT_FOUND' },
    });
  });
});
