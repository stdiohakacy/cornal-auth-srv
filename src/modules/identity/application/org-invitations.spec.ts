import { ConsumeOrgInvitationUseCase } from './consume-org-invitation.use-case.js';
import {
  capturingEmailSender,
  fixedClock,
  InMemoryOneTimeTokens,
  InMemoryUserRepository,
  NOW,
  passthroughUow,
  sequentialTokens,
} from './identity.test-support.js';
import { IssueOrgInvitationUseCase } from './issue-org-invitation.use-case.js';
import { ListOrgInvitationsUseCase } from './list-org-invitations.use-case.js';
import { RevokeOrgInvitationUseCase } from './revoke-org-invitation.use-case.js';

const URL_BASE = 'http://localhost:3000/accept-invitation';

function setup() {
  const users = new InMemoryUserRepository();
  const tokens = new InMemoryOneTimeTokens();
  const generator = sequentialTokens();
  const mail = capturingEmailSender();
  const issue = new IssueOrgInvitationUseCase(
    tokens,
    generator,
    mail.sender,
    passthroughUow,
    fixedClock,
    URL_BASE,
  );
  const consume = new ConsumeOrgInvitationUseCase(
    users,
    tokens,
    generator,
    passthroughUow,
    fixedClock,
  );
  const invite = (invitationId: string, email = 'new@b.co') =>
    issue.execute({
      invitationId,
      orgId: 'org-1',
      orgName: 'Acme',
      email,
      roleIds: ['role-member'],
      invitedBy: 'u0',
    });
  return { users, tokens, mail, consume, invite };
}

describe('org invitation façades', () => {
  it('issue revokes the previous open invite and sends one email with the link', async () => {
    const { tokens, mail, invite } = setup();

    await invite('inv-1');
    await invite('inv-2');

    expect(mail.sent.at(-1)).toEqual({
      to: 'new@b.co',
      template: 'org-invitation',
      data: {
        link: `${URL_BASE}?token=raw-2`,
        orgName: 'Acme',
        expiresInMs: 7 * 24 * 60 * 60 * 1000,
      },
    });
    const open = await new ListOrgInvitationsUseCase(
      tokens,
      fixedClock,
    ).execute({ orgId: 'org-1' });
    expect(open.map((i) => i.invitationId)).toEqual(['inv-2']);
    expect(open[0]).toMatchObject({
      email: 'new@b.co',
      roleIds: ['role-member'],
      invitedBy: 'u0',
    });
  });

  it('consume: verified user with the invited email gets the payload once', async () => {
    const { users, consume, invite } = setup();
    const user = users.seed('new@b.co');
    user.verifyEmail(NOW);
    await invite('inv-1');

    expect(await consume.execute({ token: 'raw-1', userId: user.id })).toEqual({
      invitationId: 'inv-1',
      orgId: 'org-1',
      email: 'new@b.co',
      roleIds: ['role-member'],
      invitedBy: 'u0',
    });
    expect(
      await consume.execute({ token: 'raw-1', userId: user.id }),
    ).toBeUndefined();
  });

  it('consume: wrong email / unverified / unknown token → undefined, nothing consumed', async () => {
    const { users, tokens, consume, invite } = setup();
    const other = users.seed('other@b.co');
    other.verifyEmail(NOW);
    const unverified = users.seed('new@b.co');
    await invite('inv-1');

    expect(
      await consume.execute({ token: 'raw-1', userId: other.id }),
    ).toBeUndefined();
    expect(
      await consume.execute({ token: 'raw-1', userId: unverified.id }),
    ).toBeUndefined();
    expect(
      await consume.execute({ token: 'nope', userId: other.id }),
    ).toBeUndefined();
    expect(
      await new ListOrgInvitationsUseCase(tokens, fixedClock).execute({
        orgId: 'org-1',
      }),
    ).toHaveLength(1);
  });

  it('revoke removes an open invite of that org only', async () => {
    const { tokens, invite } = setup();
    await invite('inv-1');
    const revoke = new RevokeOrgInvitationUseCase(tokens, passthroughUow);

    expect(
      await revoke.execute({ orgId: 'org-other', invitationId: 'inv-1' }),
    ).toBe(false);
    expect(
      await revoke.execute({ orgId: 'org-1', invitationId: 'inv-1' }),
    ).toBe(true);
    expect(
      await new ListOrgInvitationsUseCase(tokens, fixedClock).execute({
        orgId: 'org-1',
      }),
    ).toEqual([]);
  });
});
