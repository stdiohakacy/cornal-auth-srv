import {
  Global,
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '#src/config/env.schema.js';
import { ReadinessRegistry } from '#src/health/readiness.registry.js';

export const REDIS = Symbol('REDIS');

/**
 * One shared ioredis client. Commands fail fast while Redis is down (no offline queue), so
 * callers can degrade (rate limiting) or fail closed (lockout) instead of hanging.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Redis(config.REDIS_URL, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly readiness: ReadinessRegistry,
  ) {}

  onModuleInit(): void {
    this.readiness.register(
      'redis',
      async () => (await this.redis.ping()) === 'PONG',
    );
  }

  /** Graceful QUIT when connected; a client still (re)connecting is simply dropped. */
  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === 'ready') {
      await this.redis.quit();
      return;
    }
    this.redis.disconnect();
  }
}
