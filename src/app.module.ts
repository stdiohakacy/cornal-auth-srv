import { type DynamicModule, Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import type { AppConfig } from './config/env.schema.js';
import { HealthModule } from './health/health.module.js';
import { LoggingModule } from './shared/infrastructure/logging/logging.module.js';
import { RequestContextModule } from './shared/infrastructure/request-context/request-context.module.js';

/**
 * One image, three roles (`login` | `api` | `worker`). Each phase adds its modules to the
 * role(s) that serve them, so a bug in admin endpoints cannot take the login fleet down.
 */
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
      ],
    };
  }
}
