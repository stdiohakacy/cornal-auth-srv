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
} from '#src/contracts/organization.schemas.js';
import { definedProps } from '#src/shared/domain/defined-props.js';
import { unwrap } from '#src/shared/infrastructure/http/unwrap.js';
import { PermissionsGuard } from '#src/modules/access-control/presentation/permissions.guard.js';
import { RequirePermissions } from '#src/modules/access-control/presentation/require-permissions.decorator.js';
import type { AccessClaims } from '#src/modules/session/application/ports.js';
import { AccessTokenGuard } from '#src/modules/session/presentation/access-token.guard.js';
import { CurrentAuth } from '#src/modules/session/presentation/current-auth.decorator.js';
import { OrgErrorCode } from '#src/contracts/error-codes.js';
import { ApiErrors } from '#src/shared/infrastructure/http/openapi/api-docs.js';
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
  @ApiErrors(
    OrgErrorCode.MemberNotFound,
    OrgErrorCode.RoleNotFound,
    OrgErrorCode.InsufficientPrivilege,
    OrgErrorCode.LastOwner,
  )
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
        ...definedProps(body),
      }),
    );
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('member:manage')
  @ApiErrors(
    OrgErrorCode.MemberNotFound,
    OrgErrorCode.InsufficientPrivilege,
    OrgErrorCode.LastOwner,
  )
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
