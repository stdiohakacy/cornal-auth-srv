import { type DynamicModule, Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import type { AppConfig, AppRole } from './config/env.schema.js';
import { HealthModule } from './health/health.module.js';
import { AccessControlCoreModule } from './modules/access-control/access-control-core.module.js';
import { AccessControlHttpModule } from './modules/access-control/access-control-http.module.js';
import { OrganizationApiModule } from './modules/organization/organization-api.module.js';
import { IdentityApiModule } from './modules/identity/identity-api.module.js';
import { IdentityHttpModule } from './modules/identity/identity-http.module.js';
import { IdentityWorkerModule } from './modules/identity/identity-worker.module.js';
import {
  SessionApiModule,
  SessionHttpModule,
} from './modules/session/session-http.module.js';
import { assertNever } from './shared/domain/guard.js';
import { SessionWorkerModule } from './modules/session/session-worker.module.js';
import { ClockModule } from './shared/infrastructure/clock.module.js';
import { AppMailModule } from './shared/infrastructure/mail/mail.module.js';
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
      return [IdentityHttpModule, SessionHttpModule];
    case 'api':
      return [
        SessionApiModule,
        IdentityApiModule,
        OrganizationApiModule,
        AccessControlHttpModule,
      ];
    case 'worker':
      return [IdentityWorkerModule, SessionWorkerModule];
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
        AccessControlCoreModule,
        RedisModule,
        ClockModule,
        AppMailModule,
        ...roleModules(config.APP_ROLE),
      ],
    };
  }
}
