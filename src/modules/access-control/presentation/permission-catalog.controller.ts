import { Controller, Get, Header } from '@nestjs/common';
import {
  type PermissionCatalogResponse,
  PermissionCatalogResponseSchema,
} from '#src/contracts/organization.schemas.js';
import {
  PERMISSIONS,
  PERMISSION_CATALOG_VERSION,
} from '#src/contracts/permissions.js';
import { ApiResult } from '#src/shared/infrastructure/http/openapi/api-docs.js';

const ETAG = `"pcv-${PERMISSION_CATALOG_VERSION}"`;

/** code→bit mapping for decoding `pbits` (gateway, authz-agent, other services). */
@Controller('.well-known')
export class PermissionCatalogController {
  @Get('permission-catalog.json')
  @Header('Cache-Control', 'public, max-age=300')
  @Header('ETag', ETAG) // Express answers a matching If-None-Match with 304
  @ApiResult(PermissionCatalogResponseSchema)
  catalog(): PermissionCatalogResponse {
    return {
      version: PERMISSION_CATALOG_VERSION,
      permissions: PERMISSIONS.map(({ code, bit, description }) => ({
        code,
        bit,
        description,
      })),
    };
  }
}
