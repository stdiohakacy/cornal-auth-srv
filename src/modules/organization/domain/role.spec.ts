import type { RoleId } from './membership.js';
import { PermissionSet, Role, RoleKey } from './role.js';

const now = new Date('2026-11-27T12:00:00Z');

function viewerKey(): RoleKey {
  const key = RoleKey.create('billing_viewer');
  if (!key.ok) throw new Error('fixture');
  return key.value;
}

describe('RoleKey', () => {
  it('rejects reserved and malformed keys', () => {
    for (const bad of [
      'owner',
      'admin',
      'member',
      'Admin',
      'a',
      '-x',
      'x'.repeat(33),
    ]) {
      expect(RoleKey.create(bad)).toMatchObject({
        ok: false,
        error: { code: 'ORG.INVALID_ROLE_KEY' },
      });
    }
    expect(RoleKey.create('billing_viewer')).toMatchObject({
      ok: true,
      value: { value: 'billing_viewer' },
    });
  });
});

describe('Role', () => {
  it('setPermissions reports change only when the set differs; added/removed tracked', () => {
    const role = Role.reconstitute(
      'role-1' as RoleId,
      {
        orgId: 'org-1',
        key: viewerKey(),
        name: 'Viewer',
        permissions: new PermissionSet(['org:read']),
        createdAt: now,
      },
      1,
    );

    expect(role.setPermissions(['org:read'])).toBe(false);
    expect(role.setPermissions(['member:read'])).toBe(true);
    expect(role.permissions.items).toEqual(['member:read']);
    expect(role.permissions.added).toEqual(['member:read']);
    expect(role.permissions.removed).toEqual(['org:read']);
  });

  it('rename changes the name', () => {
    const role = Role.create({
      orgId: 'org-1',
      key: viewerKey(),
      name: 'Viewer',
      permissions: [],
      now,
    });

    role.rename('Billing viewer');

    expect(role.name).toBe('Billing viewer');
    expect(role.orgId).toBe('org-1');
    expect(role.key.value).toBe('billing_viewer');
  });
});
