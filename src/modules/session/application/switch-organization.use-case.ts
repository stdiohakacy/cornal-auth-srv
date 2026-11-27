import type { Clock, UnitOfWork } from '#src/shared/application/ports.js';
import { err, ok, type Result } from '#src/shared/domain/result.js';
import type { Session, SessionId } from '../domain/session.js';
import {
  OrgMfaRequiredError,
  OrgNotMemberError,
  SessionInvalidError,
} from '../domain/session.errors.js';
import { issueAccessToken } from './issued-tokens.js';
import {
  type AccessTokenService,
  type OrgContext,
  orgAllowedFor,
  type OrgContextReader,
  type SessionRepository,
} from './ports.js';

export type SwitchOrganizationError =
  OrgNotMemberError | OrgMfaRequiredError | SessionInvalidError;

/**
 * Scopes the current session to another organization and issues an access token for it.
 * No new refresh token: the refresh family stays the same, it just remembers the org.
 */
export class SwitchOrganizationUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly orgs: OrgContextReader,
    private readonly accessTokens: AccessTokenService,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    sessionId: SessionId;
    userId: string;
    orgId: string;
    tokenVersion: number;
  }): Promise<
    Result<{ accessToken: string; expiresIn: number }, SwitchOrganizationError>
  > {
    const switched = await this.uow.run(
      async (): Promise<
        Result<
          { session: Session; context: OrgContext },
          SwitchOrganizationError
        >
      > => {
        const session = await this.sessions.findById(input.sessionId);
        if (
          !session ||
          session.userId !== input.userId ||
          !session.isActive(this.clock.now())
        ) {
          return err(new SessionInvalidError());
        }
        const context = await this.orgs.contextFor(input.userId, input.orgId);
        if (!context) return err(new OrgNotMemberError());
        if (!orgAllowedFor(context, session.snapshot.amr))
          return err(new OrgMfaRequiredError());
        session.selectOrganization(context.orgId);
        await this.sessions.save(session);
        return ok({ session, context });
      },
    );
    if (!switched.ok) return switched;

    const { session, context } = switched.value;
    const access = await issueAccessToken(this.accessTokens, {
      session,
      tokenVersion: input.tokenVersion,
      org: context,
    });
    return ok({ accessToken: access.token, expiresIn: access.expiresIn });
  }
}
