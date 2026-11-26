import { type DynamicModule, Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import type { AppConfig, AppRole } from './config/env.schema.js';
import { HealthModule } from './health/health.module.js';
import { IdentityHttpModule } from './modules/identity/identity-http.module.js';
import { IdentityWorkerModule } from './modules/identity/identity-worker.module.js';
import { assertNever } from './shared/domain/guard.js';
import { ClockModule } from './shared/infrastructure/clock.module.js';
import { LoggingModule } from './shared/infrastructure/logging/logging.module.js';
import { PersistenceModule } from './shared/infrastructure/persistence/persistence.module.js';
import { RedisModule } from './shared/infrastructure/redis/redis.module.js';
import { RequestContextModule } from './shared/infrastructure/request-context/request-context.module.js';

/**
 * One image, three roles (`login` | `api` | `worker`). Each phase adds its modules to the
 * role(s) that serve them, so a bug in admin endpoints cannot take the login fleet down.
 */
/** Feature modules served by each role. */
function roleModules(role: AppRole) {
  switch (role) {
    case 'login':
      return [IdentityHttpModule];
    case 'api':
      return [];
    case 'worker':
      return [IdentityWorkerModule];
    default:
      return assertNever(role);
  }
}

@Module({})
export class AppModule {
  static forRole(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        RequestContextModule,
        LoggingModule,
        HealthModule,
        PersistenceModule,
        RedisModule,
        ClockModule,
        ...roleModules(config.APP_ROLE),
      ],
    };
  }
}
