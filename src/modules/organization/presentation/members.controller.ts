import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  MembershipIdParamSchema,
  OrgIdParamSchema,
  type UpdateMemberRequest,
  UpdateMemberRequestSchema,
} from '../../../contracts/organization.schemas.js';
import { unwrap } from '../../../shared/infrastructure/http/unwrap.js';
import { PermissionsGuard } from '../../access-control/presentation/permissions.guard.js';
import { RequirePermissions } from '../../access-control/presentation/require-permissions.decorator.js';
import type { AccessClaims } from '../../session/application/ports.js';
import { AccessTokenGuard } from '../../session/presentation/access-token.guard.js';
import { CurrentAuth } from '../../session/presentation/current-auth.decorator.js';
import { RemoveMemberUseCase } from '../application/remove-member.use-case.js';
import { UpdateMemberUseCase } from '../application/update-member.use-case.js';

@Controller('iam/orgs/:orgId/members/:membershipId')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class MembersController {
  constructor(
    private readonly updateMember: UpdateMemberUseCase,
    private readonly removeMember: RemoveMemberUseCase,
  ) {}

  @Patch()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('member:manage')
  async update(
    @CurrentAuth() auth: AccessClaims,
    @Param('orgId', { schema: OrgIdParamSchema }) orgId: string,
    @Param('membershipId', { schema: MembershipIdParamSchema })
    membershipId: string,
    @Body({ schema: UpdateMemberRequestSchema }) body: UpdateMemberRequest,
  ): Promise<void> {
    unwrap(
      await this.updateMember.execute({
        actorUserId: auth.sub,
        orgId,
        membershipId,
        ...(body.roleIds !== undefined ? { roleIds: body.roleIds } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      }),
    );
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('member:manage')
  async remove(
    @CurrentAuth() auth: AccessClaims,
    @Param('orgId', { schema: OrgIdParamSchema }) orgId: string,
    @Param('membershipId', { schema: MembershipIdParamSchema })
    membershipId: string,
  ): Promise<void> {
    unwrap(
      await this.removeMember.execute({
        actorUserId: auth.sub,
        orgId,
        membershipId,
      }),
    );
  }
}
