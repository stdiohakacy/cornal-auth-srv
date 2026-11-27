import { type AppConfig, parseConfig } from './env.schema.js';

/**
 * Real schema defaults + test-only values. Every test config derives from here, so adding an env
 * variable never requires editing test fixtures. Imported by tests only (excluded from builds).
 */
export function buildTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const parsed = parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL:
      'postgres://cornal_auth:cornal_auth@localhost:5432/cornal_auth',
    DATABASE_DIRECT_URL:
      'postgres://cornal_auth:cornal_auth@localhost:5432/cornal_auth',
    REDIS_URL: 'redis://localhost:6379',
    NATS_URL: 'nats://localhost:4222',
    OUTBOX_RELAY_ENABLED: 'false',
    PASSWORD_BREACH_CHECK: 'false',
  });
  if (!parsed.ok) throw new Error(`Invalid test config:\n${parsed.error}`);
  return Object.freeze({ ...parsed.value, ...overrides });
}
