import type { Id } from '#src/shared/domain/id.js';
import { Invitation } from './invitation.js';
import { Membership } from './membership.js';
import { Organization } from './organization.js';
import { Slug } from './slug.js';

const now = new Date('2026-11-27T12:00:00Z');

describe('Slug', () => {
  it('normalizes case and rejects bad shapes', () => {
    expect(Slug.create('Acme-Corp')).toMatchObject({
      ok: true,
      value: { value: 'acme-corp' },
    });
    for (const bad of [
      'a',
      '-acme',
      'acme-',
      'acme corp',
      'ac_me',
      'x'.repeat(49),
    ]) {
      expect(Slug.create(bad)).toMatchObject({
        ok: false,
        error: { code: 'ORG.INVALID_SLUG' },
      });
    }
  });
});

describe('Organization', () => {
  it('create raises organization.created', () => {
    const slug = Slug.create('acme');
    if (!slug.ok) throw slug.error;

    const org = Organization.create({ name: 'Acme', slug: slug.value, now });

    expect(org.snapshot).toMatchObject({
      name: 'Acme',
      status: 'active',
      authzEpoch: 0,
      mfaRequired: false,
    });
    expect(org.pendingEvents.map((e) => e.type)).toEqual([
      'organization.created',
    ]);
  });
});

describe('Membership', () => {
  it('owner membership has the owner role and is active', () => {
    const ownerRoleId = 'role-owner' as Id<'Role'>;

    const membership = Membership.createOwner({
      orgId: 'org-1',
      userId: 'user-1',
      ownerRoleId,
      now,
    });

    expect(membership.isActive).toBe(true);
    expect(membership.roles.items).toEqual([ownerRoleId]);
    expect(membership.roles.added).toEqual([ownerRoleId]);
    expect(membership.authzVersion).toBe(0);
    expect(membership.pendingEvents.map((e) => e.type)).toEqual([
      'organization.member_added',
    ]);
  });
});

describe('Organization authz epoch', () => {
  it('bumpAuthzEpoch increments', () => {
    const slug = Slug.create('acme');
    if (!slug.ok) throw new Error('fixture');
    const org = Organization.create({ name: 'Acme', slug: slug.value, now });

    org.bumpAuthzEpoch();
    org.bumpAuthzEpoch();

    expect(org.snapshot.authzEpoch).toBe(2);
  });
});

describe('Invitation', () => {
  it('create raises organization.invitation.created with the payload', () => {
    const invitation = Invitation.create({
      orgId: 'org-1',
      orgName: 'Acme',
      email: 'new@b.co',
      roleIds: ['role-member'],
      invitedBy: 'u1',
      now,
    });

    expect(invitation.pendingEvents).toEqual([
      expect.objectContaining({
        type: 'organization.invitation.created',
        aggregateId: invitation.id,
        payload: {
          invitationId: invitation.id,
          orgId: 'org-1',
          orgName: 'Acme',
          email: 'new@b.co',
          roleIds: ['role-member'],
          invitedBy: 'u1',
        },
      }),
    ]);
  });
});
