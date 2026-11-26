import type { AppConfig } from '../../../config/env.schema.js';

export function testConfigFor(level: AppConfig['LOG_LEVEL']): AppConfig {
  return Object.freeze({
    NODE_ENV: 'test',
    APP_ROLE: 'api',
    PORT: 3001,
    LOG_LEVEL: level,
    TRUST_PROXY: 'loopback',
    DATABASE_URL: 'postgres://u:p@localhost:6432/db',
    DATABASE_DIRECT_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    NATS_URL: 'nats://localhost:4222',
  });
}
