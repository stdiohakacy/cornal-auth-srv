import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  type CreateOrganizationRequest,
  CreateOrganizationRequestSchema,
  type MemberListResponse,
  OrgIdParamSchema,
  type OrganizationListResponse,
  type OrganizationSummary,
} from '#src/contracts/organization.schemas.js';
import { unwrap } from '#src/shared/infrastructure/http/unwrap.js';
import { PermissionsGuard } from '#src/modules/access-control/presentation/permissions.guard.js';
import { RequirePermissions } from '#src/modules/access-control/presentation/require-permissions.decorator.js';
import type { AccessClaims } from '#src/modules/session/application/ports.js';
import { AccessTokenGuard } from '#src/modules/session/presentation/access-token.guard.js';
import { CurrentAuth } from '#src/modules/session/presentation/current-auth.decorator.js';
import { CreateOrganizationUseCase } from '../application/create-organization.use-case.js';
import { ListMembersUseCase } from '../application/list-members.use-case.js';
import { ListMyOrganizationsUseCase } from '../application/list-my-organizations.use-case.js';

@Controller('iam')
@UseGuards(AccessTokenGuard)
export class OrganizationsController {
  constructor(
    private readonly createOrganization: CreateOrganizationUseCase,
    private readonly listMyOrganizations: ListMyOrganizationsUseCase,
    private readonly listMembers: ListMembersUseCase,
  ) {}

  @Post('orgs')
  async create(
    @CurrentAuth() auth: AccessClaims,
    @Body({ schema: CreateOrganizationRequestSchema })
    body: CreateOrganizationRequest,
  ): Promise<OrganizationSummary> {
    const created = unwrap(
      await this.createOrganization.execute({ userId: auth.sub, ...body }),
    );
    return {
      id: created.orgId,
      slug: created.slug,
      name: created.name,
      roles: ['owner'],
    };
  }

  @Get('me/organizations')
  async mine(
    @CurrentAuth() auth: AccessClaims,
  ): Promise<OrganizationListResponse> {
    const rows = await this.listMyOrganizations.execute({ userId: auth.sub });
    return {
      organizations: rows.map((r) => ({
        id: r.orgId,
        slug: r.slug,
        name: r.name,
        roles: [...r.roleKeys],
      })),
    };
  }

  @Get('orgs/:orgId/members')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('member:read')
  async members(
    @Param('orgId', { schema: OrgIdParamSchema }) orgId: string,
  ): Promise<MemberListResponse> {
    const members = await this.listMembers.execute({ orgId });
    return { members: members.map((m) => ({ ...m, roles: [...m.roles] })) };
  }
}
