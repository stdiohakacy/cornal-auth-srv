import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module.js';
import { type AppRole, parseConfig } from '../config/env.schema.js';
import { createAppOpenApiDocument } from './app-openapi.js';

/** Roles that serve HTTP routes besides /health. */
const HTTP_ROLES: readonly AppRole[] = ['login', 'api'];
const OUT_DIR = 'openapi';

/**
 * Writes openapi/<role>.json for the gateway, other services and client codegen.
 * Preview mode builds the module graph without instantiating providers: no DB or Redis needed.
 */
async function exportOpenApi(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const parsed = parseConfig(process.env);
  if (!parsed.ok) {
    process.stderr.write(
      `Invalid environment configuration:\n${parsed.error}\n`,
    );
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const role of HTTP_ROLES) {
    const config = { ...parsed.value, APP_ROLE: role };
    const app = await NestFactory.create<NestExpressApplication>(
      AppModule.forRole(config),
      { preview: true, logger: false },
    );
    const document = createAppOpenApiDocument(app, config);
    const file = `${OUT_DIR}/${role}.json`;
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
    process.stdout.write(`wrote ${file}\n`);
    await app.close();
  }
}

await exportOpenApi();
