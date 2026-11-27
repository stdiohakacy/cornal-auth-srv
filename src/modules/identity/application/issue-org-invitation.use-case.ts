import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { ok } from '../../../shared/domain/result.js';
import type {
  EmailSender,
  OneTimeTokenRepository,
  OrgInvitePayload,
  SecretTokenGenerator,
} from './ports.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
        expiresAt: new Date(this.clock.now().getTime() + INVITE_TTL_MS),
      });
      const link = new URL(this.invitationUrl);
      link.searchParams.set('token', raw);
      await this.emails.send({
        to: payload.email,
        template: 'org-invitation',
        data: { link: link.toString(), orgName },
      });
      return ok(undefined);
    });
  }
}
