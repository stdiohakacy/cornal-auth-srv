import { randomUUIDv7 } from 'node:crypto';
import { OutboxRelay } from '@nestjs/outbox';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { decodeJwt } from 'jose';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { permissionCatalog } from '../../src/contracts/permissions.js';
import {
  EMAIL_SENDER,
  type EmailMessage,
} from '../../src/modules/identity/application/ports.js';
import { IdentityHttpModule } from '../../src/modules/identity/identity-http.module.js';
import { IdentityWorkerModule } from '../../src/modules/identity/identity-worker.module.js';
import { OrganizationWorkerModule } from '../../src/modules/organization/organization-worker.module.js';
import { SessionHttpModule } from '../../src/modules/session/session-http.module.js';
import {
  decodePermissionBits,
  hasPermission,
} from '../../src/sdk/permission-bits.js';
import { createTestApp } from './support/create-app.js';

let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `100.81.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};
const PASSWORD = 'correct-horse-battery';

type Tokens = { access: string; refresh: string };

describe('organization members, roles & invitations (e2e)', () => {
  let app: NestExpressApplication;
  const sent: EmailMessage[] = [];

  beforeAll(async () => {
    app = await createTestApp(
      { APP_ROLE: 'api' },
      {
        imports: [
          IdentityHttpModule,
          SessionHttpModule,
          IdentityWorkerModule,
          OrganizationWorkerModule,
        ],
        providers: [
          {
            token: EMAIL_SENDER,
            value: { send: async (m: EmailMessage) => void sent.push(m) },
          },
        ],
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const relay = () => app.get(OutboxRelay).runOnce();
  const tokenOf = (link: string | undefined) =>
    new URL(link ?? 'http://x').searchParams.get('token');

  async function registered(): Promise<string> {
    const email = `mem-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
    await http()
      .post('/auth/register')
      .set('x-forwarded-for', nextIp())
      .send({ email, password: PASSWORD })
      .expect(202);
    await relay();
    const link = sent.find(
      (m) => m.to === email && m.template === 'verify-email',
    )?.data.link;
    await http()
      .post('/auth/verify-email')
      .set('x-forwarded-for', nextIp())
      .send({ token: tokenOf(link) })
      .expect(204);
    return email;
  }
  async function login(email: string): Promise<Tokens> {
    const res = await http()
      .post('/auth/login')
      .set('x-forwarded-for', nextIp())
      .set('x-client-type', 'mobile')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { access: res.body.accessToken, refresh: res.body.refreshToken };
  }
  async function refresh(tokens: Tokens): Promise<Tokens> {
    const res = await http()
      .post('/auth/refresh')
      .set('x-client-type', 'mobile')
      .send({ refreshToken: tokens.refresh })
      .expect(200);
    return { access: res.body.accessToken, refresh: res.body.refreshToken };
  }
  async function switchTo(
    token: string,
    orgId: string,
  ): Promise<request.Response> {
    return http()
      .post('/auth/session/organization')
      .set(auth(token))
      .send({ orgId });
  }
  /** Owner with an org; returns an org-scoped owner token. */
  async function ownerWithOrg() {
    const email = await registered();
    const tokens = await login(email);
    const { body: org } = await http()
      .post('/iam/orgs')
      .set(auth(tokens.access))
      .send({ name: 'Acme', slug: `m-${randomUUIDv7().slice(-12)}` })
      .expect(201);
    const scoped = (await switchTo(tokens.access, org.id)).body
      .accessToken as string;
    const { body } = await http()
      .get(`/iam/orgs/${org.id}/roles`)
      .set(auth(scoped))
      .expect(200);
    const roleId = (key: string) =>
      (body.roles as { id: string; key: string }[]).find((r) => r.key === key)
        ?.id ?? '';
    return { email, orgId: org.id as string, token: scoped, roleId };
  }
  async function addByInvitation(
    owner: { orgId: string; token: string },
    roleIds: string[],
  ) {
    const email = await registered();
    await http()
      .post(`/iam/orgs/${owner.orgId}/invitations`)
      .set(auth(owner.token))
      .send({ email, roleIds })
      .expect(202);
    await relay();
    const link = sent.find(
      (m) => m.to === email && m.template === 'org-invitation',
    )?.data.link;
    const tokens = await login(email);
    await http()
      .post('/iam/invitations/accept')
      .set(auth(tokens.access))
      .send({ token: tokenOf(link) })
      .expect(200);
    const membershipId = await membershipIdOf(owner.orgId, email);
    return { email, tokens: await login(email), membershipId };
  }
  async function membershipIdOf(orgId: string, email: string): Promise<string> {
    const db = app.get(DataSource);
    const [row]: [{ id: string }] = await db.query(
      'SELECT m.id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 AND u.email = $2',
      [orgId, email],
    );
    return row.id;
  }
  const membersOf = async (owner: { orgId: string; token: string }) =>
    (
      await http()
        .get(`/iam/orgs/${owner.orgId}/members`)
        .set(auth(owner.token))
        .expect(200)
    ).body.members as {
      email: string;
      roles: string[];
    }[];

  it('owner invites → email → invitee accepts → listed as member; invitation no longer listed', async () => {
    const owner = await ownerWithOrg();
    const invitee = await registered();

    const invited = await http()
      .post(`/iam/orgs/${owner.orgId}/invitations`)
      .set(auth(owner.token))
      .send({
        email: invitee.toUpperCase(),
        roleIds: [owner.roleId('member')],
      });
    expect(invited.status).toBe(202);
    await relay();
    const listed = await http()
      .get(`/iam/orgs/${owner.orgId}/invitations`)
      .set(auth(owner.token))
      .expect(200);
    expect(listed.body.invitations).toEqual([
      expect.objectContaining({
        invitationId: invited.body.invitationId,
        email: invitee,
      }),
    ]);

    const mail = sent.find(
      (m) => m.to === invitee && m.template === 'org-invitation',
    );
    expect(mail?.data.orgName).toBe('Acme');
    const { access } = await login(invitee);
    const accepted = await http()
      .post('/iam/invitations/accept')
      .set(auth(access))
      .send({ token: tokenOf(mail?.data.link) });

    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ orgId: owner.orgId });
    expect(await membersOf(owner)).toContainEqual(
      expect.objectContaining({ email: invitee, roles: ['member'] }),
    );
    const after = await http()
      .get(`/iam/orgs/${owner.orgId}/invitations`)
      .set(auth(owner.token))
      .expect(200);
    expect(after.body.invitations).toEqual([]);
  });

  it('accept with another account → 400 ORG.INVITATION_INVALID', async () => {
    const owner = await ownerWithOrg();
    const invitee = await registered();
    await http()
      .post(`/iam/orgs/${owner.orgId}/invitations`)
      .set(auth(owner.token))
      .send({ email: invitee, roleIds: [owner.roleId('member')] })
      .expect(202);
    await relay();
    const link = sent.find(
      (m) => m.to === invitee && m.template === 'org-invitation',
    )?.data.link;
    const intruder = await login(await registered());

    const res = await http()
      .post('/iam/invitations/accept')
      .set(auth(intruder.access))
      .send({ token: tokenOf(link) });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ORG.INVITATION_INVALID');
  });

  it('admin cannot grant owner → 403 ORG.INSUFFICIENT_PRIVILEGE', async () => {
    const owner = await ownerWithOrg();
    const admin = await addByInvitation(owner, [owner.roleId('admin')]);
    const member = await addByInvitation(owner, [owner.roleId('member')]);
    const adminToken = (await switchTo(admin.tokens.access, owner.orgId)).body
      .accessToken as string;

    const res = await http()
      .patch(`/iam/orgs/${owner.orgId}/members/${member.membershipId}`)
      .set(auth(adminToken))
      .send({ roleIds: [owner.roleId('owner')] });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG.INSUFFICIENT_PRIVILEGE');
  });

  it('sole owner cannot demote self → 409 ORG.LAST_OWNER', async () => {
    const owner = await ownerWithOrg();
    const ownMembershipId = decodeJwt(owner.token)['mid'];

    const res = await http()
      .patch(`/iam/orgs/${owner.orgId}/members/${String(ownMembershipId)}`)
      .set(auth(owner.token))
      .send({ roleIds: [owner.roleId('admin')] });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ORG.LAST_OWNER');
  });

  it('custom role: create → assign → refreshed token carries its bits → delete while assigned → 409', async () => {
    const owner = await ownerWithOrg();
    const member = await addByInvitation(owner, [owner.roleId('member')]);
    const created = await http()
      .post(`/iam/orgs/${owner.orgId}/roles`)
      .set(auth(owner.token))
      .send({
        key: 'auditor',
        name: 'Auditor',
        permissions: ['audit:read', 'org:read'],
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      key: 'auditor',
      system: false,
      permissions: ['audit:read', 'org:read'],
    });

    await http()
      .patch(`/iam/orgs/${owner.orgId}/members/${member.membershipId}`)
      .set(auth(owner.token))
      .send({ roleIds: [created.body.id] })
      .expect(204);

    const refreshed = await refresh(member.tokens);
    const claims = decodeJwt(refreshed.access);
    expect(claims).toMatchObject({ org: owner.orgId, mv: 1 });
    const bits = decodePermissionBits(String(claims['pbits']));
    expect(hasPermission(permissionCatalog(), bits, 'audit:read')).toBe(true);
    expect(hasPermission(permissionCatalog(), bits, 'member:read')).toBe(false);

    const deleted = await http()
      .delete(`/iam/orgs/${owner.orgId}/roles/${created.body.id}`)
      .set(auth(owner.token));
    expect(deleted.status).toBe(409);
    expect(deleted.body.code).toBe('ORG.ROLE_IN_USE');
  });

  it('suspended member: refresh drops the org; switching back → 403 ORG.NOT_MEMBER', async () => {
    const owner = await ownerWithOrg();
    const member = await addByInvitation(owner, [owner.roleId('member')]);
    expect(decodeJwt(member.tokens.access)['org']).toBe(owner.orgId);

    await http()
      .patch(`/iam/orgs/${owner.orgId}/members/${member.membershipId}`)
      .set(auth(owner.token))
      .send({ status: 'suspended' })
      .expect(204);

    const refreshed = await refresh(member.tokens);
    expect(decodeJwt(refreshed.access)['org']).toBeUndefined();
    const res = await switchTo(refreshed.access, owner.orgId);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG.NOT_MEMBER');
  });

  it('remove member → 204; members list no longer shows them', async () => {
    const owner = await ownerWithOrg();
    const member = await addByInvitation(owner, [owner.roleId('member')]);

    await http()
      .delete(`/iam/orgs/${owner.orgId}/members/${member.membershipId}`)
      .set(auth(owner.token))
      .expect(204);

    expect((await membersOf(owner)).map((m) => m.email)).not.toContain(
      member.email,
    );
  });

  it('revoke invitation → 204; accepting it → 400', async () => {
    const owner = await ownerWithOrg();
    const invitee = await registered();
    const { body } = await http()
      .post(`/iam/orgs/${owner.orgId}/invitations`)
      .set(auth(owner.token))
      .send({ email: invitee, roleIds: [owner.roleId('member')] })
      .expect(202);
    await relay();
    const link = sent.find(
      (m) => m.to === invitee && m.template === 'org-invitation',
    )?.data.link;

    await http()
      .delete(`/iam/orgs/${owner.orgId}/invitations/${body.invitationId}`)
      .set(auth(owner.token))
      .expect(204);

    const { access } = await login(invitee);
    const res = await http()
      .post('/iam/invitations/accept')
      .set(auth(access))
      .send({ token: tokenOf(link) });
    expect(res.status).toBe(400);
  });
});
