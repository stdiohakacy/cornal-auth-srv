import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { parseConfig } from './config/env.schema.js';
import { configureHttp } from './shared/infrastructure/http/configure-http.js';

async function bootstrap(): Promise<void> {
  // Local development only: production injects real environment variables.
  if (existsSync('.env')) process.loadEnvFile('.env');

  const config = parseConfig(process.env);
  if (!config.ok) {
    process.stderr.write(
      `Invalid environment configuration:\n${config.error}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRole(config.value),
    { bufferLogs: true },
  );
  configureHttp(app, config.value);
  app.enableShutdownHooks();
  await app.listen(config.value.PORT);
}

await bootstrap();
