import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  type CreateRoleRequest,
  CreateRoleRequestSchema,
  OrgIdParamSchema,
  RoleIdParamSchema,
  type RoleListResponse,
  type RoleResponse,
  type UpdateRoleRequest,
  UpdateRoleRequestSchema,
} from '#src/contracts/organization.schemas.js';
import { definedProps } from '#src/shared/domain/defined-props.js';
import { unwrap } from '#src/shared/infrastructure/http/unwrap.js';
import { PermissionsGuard } from '#src/modules/access-control/presentation/permissions.guard.js';
import { RequirePermissions } from '#src/modules/access-control/presentation/require-permissions.decorator.js';
import type { AccessClaims } from '#src/modules/session/application/ports.js';
import { AccessTokenGuard } from '#src/modules/session/presentation/access-token.guard.js';
import { CurrentAuth } from '#src/modules/session/presentation/current-auth.decorator.js';
import { CreateRoleUseCase } from '../application/create-role.use-case.js';
import { DeleteRoleUseCase } from '../application/delete-role.use-case.js';
import { ListRolesUseCase } from '../application/list-roles.use-case.js';
import type { RoleView } from '../application/ports.js';
import { UpdateRoleUseCase } from '../application/update-role.use-case.js';

const toResponse = (role: RoleView): RoleResponse => ({
  ...role,
  permissions: [...role.permissions],
});

@Controller('iam/orgs/:orgId/roles')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class RolesController {
  constructor(
    private readonly listRoles: ListRolesUseCase,
    private readonly createRole: CreateRoleUseCase,
    private readonly updateRole: UpdateRoleUseCase,
    private readonly deleteRole: DeleteRoleUseCase,
  ) {}

  @Get()
  @RequirePermissions('role:read')
  async list(
    @Param('orgId', { schema: OrgIdParamSchema }) orgId: string,
  ): Promise<RoleListResponse> {
    return { roles: (await this.listRoles.execute({ orgId })).map(toResponse) };
  }

  @Post()
  @RequirePermissions('role:manage')
  async create(
    @CurrentAuth() auth: AccessClaims,
    @Param('orgId', { schema: OrgIdParamSchema }) orgId: string,
    @Body({ schema: CreateRoleRequestSchema }) body: CreateRoleRequest,
  ): Promise<RoleResponse> {
    return toResponse(
      unwrap(
        await this.createRole.execute({
          actorUserId: auth.sub,
          orgId,
          ...body,
        }),
      ),
    );
  }

  @Patch(':roleId')
  @RequirePermissions('role:manage')
  async update(
    @CurrentAuth() auth: AccessClaims,
    @Param('orgId', { schema: OrgIdParamSchema }) orgId: string,
    @Param('roleId', { schema: RoleIdParamSchema }) roleId: string,
    @Body({ schema: UpdateRoleRequestSchema }) body: UpdateRoleRequest,
  ): Promise<RoleResponse> {
    return toResponse(
      unwrap(
        await this.updateRole.execute({
          actorUserId: auth.sub,
          orgId,
          roleId,
          ...definedProps(body),
        }),
      ),
    );
  }

  @Delete(':roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('role:manage')
  async remove(
    @CurrentAuth() auth: AccessClaims,
    @Param('orgId', { schema: OrgIdParamSchema }) orgId: string,
    @Param('roleId', { schema: RoleIdParamSchema }) roleId: string,
  ): Promise<void> {
    unwrap(
      await this.deleteRole.execute({ actorUserId: auth.sub, orgId, roleId }),
    );
  }
}
