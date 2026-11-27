import type { AppConfig } from '../../../config/env.schema.js';
import { buildTestConfig } from '../../../config/test-config.test-support.js';

export function testConfigFor(level: AppConfig['LOG_LEVEL']): AppConfig {
  return buildTestConfig({ LOG_LEVEL: level, APP_ROLE: 'api', PORT: 3001 });
}
