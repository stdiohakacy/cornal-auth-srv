import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InvariantViolation } from '#src/shared/domain/domain-error.js';
import {
  type SystemRoleIds,
  syncPermissionCatalog,
} from './infrastructure/catalog-sync.js';

/** Holds the system role ids resolved by the boot-time catalog sync. */
export class SystemRoles {
  #ids: SystemRoleIds | undefined;

  set(ids: SystemRoleIds): void {
    this.#ids = ids;
  }

  get ids(): SystemRoleIds {
    if (!this.#ids)
      throw new InvariantViolation('Permission catalog not synced yet');
    return this.#ids;
  }
}

/** Every role syncs the code catalog into the database at startup (idempotent). */
@Global()
@Module({
  providers: [{ provide: SystemRoles, useValue: new SystemRoles() }],
  exports: [SystemRoles],
})
export class AccessControlCoreModule implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly systemRoles: SystemRoles,
  ) {}

  async onModuleInit(): Promise<void> {
    this.systemRoles.set(
      await this.dataSource.transaction((manager) =>
        syncPermissionCatalog(manager),
      ),
    );
  }
}
