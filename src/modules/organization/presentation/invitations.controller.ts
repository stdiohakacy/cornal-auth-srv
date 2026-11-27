import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  type AcceptInvitationRequest,
  AcceptInvitationRequestSchema,
  InvitationIdParamSchema,
  type InvitationListResponse,
  type InviteMemberRequest,
  InviteMemberRequestSchema,
  OrgIdParamSchema,
} from '../../../contracts/organization.schemas.js';
import { unwrap } from '../../../shared/infrastructure/http/unwrap.js';
import { PermissionsGuard } from '../../access-control/presentation/permissions.guard.js';
import { RequirePermissions } from '../../access-control/presentation/require-permissions.decorator.js';
import type { AccessClaims } from '../../session/application/ports.js';
import { AccessTokenGuard } from '../../session/presentation/access-token.guard.js';
import { CurrentAuth } from '../../session/presentation/current-auth.decorator.js';
import { AcceptInvitationUseCase } from '../application/accept-invitation.use-case.js';
import { InviteMemberUseCase } from '../application/invite-member.use-case.js';
import { ListInvitationsUseCase } from '../application/list-invitations.use-case.js';
import { RevokeInvitationUseCase } from '../application/revoke-invitation.use-case.js';

@Controller('iam')
@UseGuards(AccessTokenGuard)
export class InvitationsController {
  constructor(
    private readonly inviteMember: InviteMemberUseCase,
    private readonly listInvitations: ListInvitationsUseCase,
    private readonly revokeInvitation: RevokeInvitationUseCase,
    private readonly acceptInvitation: AcceptInvitationUseCase,
  ) {}

  /** 202: the email is sent asynchronously by the worker. */
  @Post('orgs/:orgId/invitations')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('member:invite')
  async invite(
    @CurrentAuth() auth: AccessClaims,
    @Param('orgId', { schema: OrgIdParamSchema }) orgId: string,
    @Body({ schema: InviteMemberRequestSchema }) body: InviteMemberRequest,
  ): Promise<{ invitationId: string }> {
    return unwrap(
      await this.inviteMember.execute({
        actorUserId: auth.sub,
        orgId,
        ...body,
      }),
    );
  }

  @Get('orgs/:orgId/invitations')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('member:invite')
  async list(
    @Param('orgId', { schema: OrgIdParamSchema }) orgId: string,
  ): Promise<InvitationListResponse> {
    const invitations = await this.listInvitations.execute({ orgId });
    return {
      invitations: invitations.map((i) => ({
        invitationId: i.invitationId,
        email: i.email,
        roleIds: [...i.roleIds],
        invitedBy: i.invitedBy,
        expiresAt: i.expiresAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
      })),
    };
  }

  @Delete('orgs/:orgId/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('member:invite')
  async revoke(
    @Param('orgId', { schema: OrgIdParamSchema }) orgId: string,
    @Param('invitationId', { schema: InvitationIdParamSchema })
    invitationId: string,
  ): Promise<void> {
    unwrap(await this.revokeInvitation.execute({ orgId, invitationId }));
  }

  /** Any signed-in user; the token must be addressed to their verified email. */
  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @CurrentAuth() auth: AccessClaims,
    @Body({ schema: AcceptInvitationRequestSchema })
    body: AcceptInvitationRequest,
  ): Promise<{ orgId: string }> {
    return unwrap(
      await this.acceptInvitation.execute({
        userId: auth.sub,
        token: body.token,
      }),
    );
  }
}
