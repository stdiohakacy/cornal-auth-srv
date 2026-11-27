import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { permissionCatalog } from '../../../contracts/permissions.js';
import {
  decodePermissionBits,
  hasPermission,
} from '../../../sdk/permission-bits.js';
import {
  AccessForbiddenError,
  OrgMismatchError,
} from '../domain/access.errors.js';
import { RequiredPermissions } from './require-permissions.decorator.js';

/** The part of `request.auth` (set by AccessTokenGuard) this guard reads. */
type OrgScopedAuth = {
  readonly org?: { readonly orgId: string; readonly pbits: string };
};

/**
 * Runs after AccessTokenGuard. Org-scoped routes: the token must carry an org, equal to the route's
 * `:orgId` when present, with every permission from @RequirePermissions set in `pbits`.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly catalog = permissionCatalog();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { auth?: OrgScopedAuth }>();
    const org = req.auth?.org;
    if (!org) throw new AccessForbiddenError();

    const routeOrgId = req.params['orgId'];
    if (typeof routeOrgId === 'string' && routeOrgId !== org.orgId)
      throw new OrgMismatchError();

    const required =
      this.reflector.getAllAndOverride(RequiredPermissions, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const bits = decodePermissionBits(org.pbits);
    if (!required.every((code) => hasPermission(this.catalog, bits, code)))
      throw new AccessForbiddenError();
    return true;
  }
}
