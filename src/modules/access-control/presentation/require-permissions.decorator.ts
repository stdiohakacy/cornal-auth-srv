import { Reflector } from '@nestjs/core';
import type { Permission } from '#src/contracts/permissions.js';

/** Metadata key read by PermissionsGuard. */
export const RequiredPermissions =
  Reflector.createDecorator<readonly Permission[]>();

/** Permissions a route needs in the token's active organization (all of them). */
export const RequirePermissions = (...codes: Permission[]) =>
  RequiredPermissions(codes);
