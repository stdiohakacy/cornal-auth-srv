import {
  Membership,
  type MembershipId,
  type RoleId,
  RoleSet,
} from './membership.js';

const now = new Date('2026-11-27T12:00:00Z');
const r = (id: string) => id as RoleId;

function member(): Membership {
  return Membership.reconstitute(
    'm-1' as MembershipId,
    {
      orgId: 'org-1',
      userId: 'u1',
      status: 'active',
      roles: new RoleSet([r('role-member')]),
      authzVersion: 0,
      createdAt: now,
    },
    1,
  );
}

describe('Membership changes', () => {
  it('createMember raises member_added with the given roles', () => {
    const m = Membership.createMember({
      orgId: 'org-1',
      userId: 'u1',
      roleIds: [r('a'), r('b')],
      now,
    });

    expect(m.isActive).toBe(true);
    expect(m.roles.items).toEqual(['a', 'b']);
    expect(m.authzVersion).toBe(0);
    expect(m.pendingEvents.map((e) => e.type)).toEqual([
      'organization.member_added',
    ]);
  });

  it('replaceRoles bumps authzVersion once per real change', () => {
    const m = member();

    expect(m.replaceRoles([r('role-member')])).toBe(false);
    expect(m.authzVersion).toBe(0);
    expect(m.replaceRoles([r('role-admin'), r('role-member')])).toBe(true);
    expect(m.authzVersion).toBe(1);
    expect(m.roles.added).toEqual(['role-admin']);
    expect(m.replaceRoles([r('role-admin')])).toBe(true);
    expect(m.authzVersion).toBe(2);
    expect(m.roles.items).toEqual(['role-admin']);
  });

  it('suspend/reactivate bump authzVersion and are idempotent', () => {
    const m = member();

    expect(m.suspend()).toBe(true);
    expect(m.suspend()).toBe(false);
    expect(m.status).toBe('suspended');
    expect(m.reactivate()).toBe(true);
    expect(m.reactivate()).toBe(false);
    expect(m.isActive).toBe(true);
    expect(m.authzVersion).toBe(2);
  });
});
