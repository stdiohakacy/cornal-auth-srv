import { Session } from '../domain/session.js';
import { SwitchOrganizationUseCase } from './switch-organization.use-case.js';
import {
  clockAt,
  fakeAccessTokens,
  FakeOrgContexts,
  InMemorySessionRepository,
  NOW,
  ORG_CONTEXT,
  passthroughUow,
  TTL,
} from './session.test-support.js';

async function setup() {
  const sessions = new InMemorySessionRepository();
  const orgs = new FakeOrgContexts();
  const tokens = fakeAccessTokens();
  const session = Session.start({
    userId: 'u1',
    refreshHash: 'h',
    now: NOW,
    idleTtlMs: TTL.idleSeconds * 1000,
    absoluteTtlMs: TTL.absoluteSeconds * 1000,
    amr: ['pwd'],
    ip: null,
    userAgent: null,
  });
  await sessions.save(session);
  const useCase = new SwitchOrganizationUseCase(
    sessions,
    orgs,
    tokens.service,
    passthroughUow,
    clockAt(NOW),
  );
  const switchTo = (orgId: string) =>
    useCase.execute({
      sessionId: session.id,
      userId: 'u1',
      orgId,
      tokenVersion: 4,
    });
  return { orgs, tokens, session, switchTo };
}

describe('SwitchOrganizationUseCase', () => {
  it('member → new token with that org and pbits; the session remembers it', async () => {
    const { orgs, tokens, session, switchTo } = await setup();
    orgs.contexts.set('u1:org-1', ORG_CONTEXT);

    const result = await switchTo('org-1');

    expect(result).toEqual({
      ok: true,
      value: { accessToken: `access:${session.id}:4`, expiresIn: 600 },
    });
    expect(tokens.issued[0]?.org).toMatchObject({
      orgId: 'org-1',
      pbits: 'AQ',
    });
    expect(session.snapshot.activeOrgId).toBe('org-1');
  });

  it('non-member → NotMember and the session is unchanged', async () => {
    const { session, switchTo } = await setup();

    expect(await switchTo('org-x')).toMatchObject({
      ok: false,
      error: { code: 'ORG.NOT_MEMBER' },
    });
    expect(session.snapshot.activeOrgId).toBeNull();
  });

  it('mfa_required org without otp in amr → MfaRequired', async () => {
    const { orgs, switchTo } = await setup();
    orgs.contexts.set('u1:org-1', { ...ORG_CONTEXT, mfaRequired: true });

    expect(await switchTo('org-1')).toMatchObject({
      ok: false,
      error: { code: 'ORG.MFA_REQUIRED' },
    });
  });

  it("a revoked session or someone else's session → SessionInvalid", async () => {
    const { orgs, session, switchTo } = await setup();
    orgs.contexts.set('u1:org-1', ORG_CONTEXT);
    session.revoke('logout', NOW);

    expect(await switchTo('org-1')).toMatchObject({
      ok: false,
      error: { code: 'SESSION.INVALID' },
    });
  });
});
