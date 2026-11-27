import type { FactoryProvider } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '#src/config/env.schema.js';
import { KeyRing } from './key-ring.js';

export const KEY_RING = Symbol('KEY_RING');

export const keyRingProvider: FactoryProvider<Promise<KeyRing>> = {
  provide: KEY_RING,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) =>
    KeyRing.fromConfig(config.JWT_SIGNING_KEYS, config.NODE_ENV),
};
