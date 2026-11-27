import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { OutboxRelay } from '@nestjs/outbox';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUIDv7 } from 'node:crypto';
import { decodeJwt } from 'jose';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { PermissionsGuard } from '../../src/modules/access-control/presentation/permissions.guard.js';
import { RequirePermissions } from '../../src/modules/access-control/presentation/require-permissions.decorator.js';
import {
  EMAIL_SENDER,
  type EmailMessage,
} from '../../src/modules/identity/application/ports.js';
import { IdentityHttpModule } from '../../src/modules/identity/identity-http.module.js';
import { IdentityWorkerModule } from '../../src/modules/identity/identity-worker.module.js';
import { AccessTokenGuard } from '../../src/modules/session/presentation/access-token.guard.js';
import { SessionGuardModule } from '../../src/modules/session/session-guard.module.js';
import { SessionHttpModule } from '../../src/modules/session/session-http.module.js';
import { createTestApp } from './support/create-app.js';

/** Test-only org-scoped route that needs member:manage (5b brings the real ones). */
@Controller('iam/orgs/:orgId/__manage-probe')
@UseGuards(AccessTokenGuard, PermissionsGuard)
class ManageProbeController {
  @Get()
  @RequirePermissions('member:manage')
  probe() {
    return { ok: true };
  }
}

@Module({ imports: [SessionGuardModule], controllers: [ManageProbeController] })
class ManageProbeModule {}

let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `100.80.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};
const PASSWORD = 'correct-horse-battery';

describe('organizations (e2e)', () => {
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
          ManageProbeModule,
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
  const bearer = (token: string) => `Bearer ${token}`;

  async function registered(verify: boolean): Promise<string> {
    const email = `org-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
    await http()
      .post('/auth/register')
      .set('x-forwarded-for', nextIp())
      .send({ email, password: PASSWORD })
      .expect(202);
    if (verify) {
      sent.length = 0;
      await app.get(OutboxRelay).runOnce();
      const link =
        sent.find((m) => m.to === email && m.template === 'verify-email')?.data
          .link ?? 'http://x';
      const token = new URL(link).searchParams.get('token');
      await http()
        .post('/auth/verify-email')
        .set('x-forwarded-for', nextIp())
        .send({ token })
        .expect(204);
    }
    return email;
  }
  async function login(email: string): Promise<string> {
    const res = await http()
      .post('/auth/login')
      .set('x-forwarded-for', nextIp())
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }
  const createOrg = (token: string, name = 'Acme') =>
    http()
      .post('/iam/orgs')
      .set('authorization', bearer(token))
      .send({ name, slug: `acme-${randomUUIDv7().slice(-12)}` });
  async function switchTo(
    token: string,
    orgId: string,
  ): Promise<request.Response> {
    return http()
      .post('/auth/session/organization')
      .set('authorization', bearer(token))
      .send({ orgId });
  }
  async function addMember(orgId: string, email: string): Promise<void> {
    const db = app.get(DataSource);
    const [{ id: userId }]: [{ id: string }] = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email],
    );
    const membershipId = randomUUIDv7();
    await db.query(
      `INSERT INTO memberships (id, org_id, user_id, status) VALUES ($1, $2, $3, 'active')`,
      [membershipId, orgId, userId],
    );
    await db.query(
      `INSERT INTO membership_roles (membership_id, role_id)
       SELECT $1, id FROM roles WHERE org_id IS NULL AND key = 'member'`,
      [membershipId],
    );
  }

  it('unverified user cannot create an org → 403 ORG.EMAIL_NOT_VERIFIED', async () => {
    const res = await createOrg(await login(await registered(false)));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG.EMAIL_NOT_VERIFIED');
  });

  it('verified user creates an org → 201; GET /iam/me/organizations lists it with role owner', async () => {
    const token = await login(await registered(true));

    const created = await createOrg(token, 'Acme Corp');
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Acme Corp', roles: ['owner'] });

    const mine = await http()
      .get('/iam/me/organizations')
      .set('authorization', bearer(token))
      .expect(200);
    expect(mine.body.organizations).toEqual([
      expect.objectContaining({ id: created.body.id, roles: ['owner'] }),
    ]);
  });

  it('after switching, the token carries org/mid/pbits and the owner lists members', async () => {
    const email = await registered(true);
    const token = await login(email);
    const { body: org } = await createOrg(token).expect(201);

    const switched = await switchTo(token, org.id);

    expect(switched.status).toBe(200);
    expect(switched.body.refreshToken).toBeUndefined();
    const claims = decodeJwt(switched.body.accessToken);
    expect(claims).toMatchObject({
      org: org.id,
      mid: expect.any(String),
      mv: 0,
      ov: 0,
      pcv: 1,
    });
    expect(typeof claims['pbits']).toBe('string');

    const members = await http()
      .get(`/iam/orgs/${org.id}/members`)
      .set('authorization', bearer(switched.body.accessToken))
      .expect(200);
    expect(members.body.members).toEqual([
      expect.objectContaining({ email, roles: ['owner'], status: 'active' }),
    ]);
  });

  it('token for org A on /iam/orgs/B/members → 403 ACCESS.ORG_MISMATCH', async () => {
    const token = await login(await registered(true));
    const { body: orgA } = await createOrg(token, 'A').expect(201);
    const { body: orgB } = await createOrg(token, 'B').expect(201);
    const scopedToA = (await switchTo(token, orgA.id)).body
      .accessToken as string;

    const res = await http()
      .get(`/iam/orgs/${orgB.id}/members`)
      .set('authorization', bearer(scopedToA));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS.ORG_MISMATCH');
  });

  it('a plain member: one org ⇒ org in the login token; member:manage route → 403, owner → 200', async () => {
    const ownerToken = await login(await registered(true));
    const { body: org } = await createOrg(ownerToken).expect(201);
    const memberEmail = await registered(true);
    await addMember(org.id, memberEmail);

    const memberToken = await login(memberEmail);
    expect(decodeJwt(memberToken)).toMatchObject({ org: org.id });

    const denied = await http()
      .get(`/iam/orgs/${org.id}/__manage-probe`)
      .set('authorization', bearer(memberToken));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('ACCESS.FORBIDDEN');

    const ownerScoped = (await switchTo(ownerToken, org.id)).body
      .accessToken as string;
    await http()
      .get(`/iam/orgs/${org.id}/__manage-probe`)
      .set('authorization', bearer(ownerScoped))
      .expect(200);
  });

  it('switch to a foreign org → 403 ORG.NOT_MEMBER', async () => {
    const outsider = await login(await registered(true));
    const { body: foreign } = await createOrg(
      await login(await registered(true)),
    ).expect(201);

    const res = await switchTo(outsider, foreign.id);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG.NOT_MEMBER');
  });

  it('org-scoped routes without an org in the token → 403 ACCESS.FORBIDDEN', async () => {
    const token = await login(await registered(true));
    const { body: org } = await createOrg(token).expect(201);

    const res = await http()
      .get(`/iam/orgs/${org.id}/members`)
      .set('authorization', bearer(token));

    // The login happened before the org existed, so the token carries no org.
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS.FORBIDDEN');
  });

  it('permission catalog endpoint serves version and ETag', async () => {
    const res = await http()
      .get('/.well-known/permission-catalog.json')
      .expect(200);

    expect(res.headers['etag']).toBe('"pcv-1"');
    expect(res.body.version).toBe(1);
    expect(res.body.permissions).toContainEqual({
      code: 'member:manage',
      bit: 4,
      description: expect.any(String),
    });
    await http()
      .get('/.well-known/permission-catalog.json')
      .set('if-none-match', '"pcv-1"')
      .expect(304);
  });
});
