import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { RedisThrottlerStorage } from '../redis/redis-throttler.storage.js';
import { AppThrottlerGuard } from './app-throttler.guard.js';
import { THROTTLERS } from './rate-limits.js';

/** Import into modules whose controllers use @UseGuards(AppThrottlerGuard). Never global. */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        throttlers: THROTTLERS,
        storage: new RedisThrottlerStorage(redis),
        setHeaders: false,
      }),
    }),
  ],
  providers: [AppThrottlerGuard],
  exports: [ThrottlerModule, AppThrottlerGuard],
})
export class ThrottlingModule {}
