import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../../../config/env.schema.js';
import { RequestContext } from '../request-context/request-context.js';
import { buildPinoHttpOptions } from './logger.options.js';

/** JSON logs via pino. `configureHttp` installs it as the Nest logger. */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG, RequestContext],
      useFactory: (config: AppConfig, ctx: RequestContext) => ({
        pinoHttp: buildPinoHttpOptions(config, ctx),
      }),
    }),
  ],
})
export class LoggingModule {}
