import { Module } from '@nestjs/common';
import { PermissionCatalogController } from './presentation/permission-catalog.controller.js';

/** `api` role: the public permission catalog. */
@Module({ controllers: [PermissionCatalogController] })
export class AccessControlHttpModule {}
