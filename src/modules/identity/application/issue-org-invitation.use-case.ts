import type { Clock, UnitOfWork } from '#src/shared/application/ports.js';
import { ok } from '#src/shared/domain/result.js';
import { IDENTITY_POLICY } from '../domain/identity-policy.js';
import type {
  EmailSender,
  OneTimeTokenRepository,
  OrgInvitePayload,
  SecretTokenGenerator,
} from './ports.js';
import { linkWithToken } from './issue-token-link.js';

/**
 * Worker side of an organization invitation: replaces any open invite for (org, email), stores the
 * sha256 of a fresh single-use token and emails the link. The raw token exists only in the email.
 */
export class IssueOrgInvitationUseCase {
  constructor(
    private readonly tokens: OneTimeTokenRepository,
    private readonly generator: SecretTokenGenerator,
    private readonly emails: EmailSender,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly invitationUrl: string,
  ) {}

  async execute(input: OrgInvitePayload & { orgName: string }): Promise<void> {
    const { orgName, ...invite } = input;
    const payload: OrgInvitePayload = {
      ...invite,
      email: invite.email.toLowerCase(),
      roleIds: [...invite.roleIds],
    };
    await this.uow.run(async () => {
      const { raw, hash } = this.generator.generate();
      await this.tokens.revokeOpenOrgInvites(payload.orgId, payload.email);
      await this.tokens.issueOrgInvite({
        tokenHash: hash,
        payload,
        expiresAt: new Date(
          this.clock.now().getTime() + IDENTITY_POLICY.tokenTtlMs.orgInvitation,
        ),
      });
      await this.emails.send({
        to: payload.email,
        template: 'org-invitation',
        data: {
          link: linkWithToken(this.invitationUrl, raw),
          orgName,
          expiresInMs: IDENTITY_POLICY.tokenTtlMs.orgInvitation,
        },
      });
      return ok(undefined);
    });
  }
}
