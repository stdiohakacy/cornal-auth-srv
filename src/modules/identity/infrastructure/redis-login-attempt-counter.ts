import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { inSeconds } from '#src/shared/domain/duration.js';
import { err, ok, type Result } from '#src/shared/domain/result.js';
import { ServiceBusyError } from '#src/shared/domain/service-busy.error.js';
import { IDENTITY_POLICY } from '../domain/identity-policy.js';
import type { LoginAttemptCounter } from '../application/ports.js';
import type { UserId } from '../domain/user.js';

const WINDOW_SECONDS = inSeconds(IDENTITY_POLICY.lockout.failureWindowMs);
const RETRY_AFTER_SECONDS = 1;

/** INCR and start the window on the first failure, atomically. */
const REGISTER_FAILURE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

/** Fails closed: an unreachable Redis becomes ServiceBusyError (503), never a skipped lockout. */
export class RedisLoginAttemptCounter implements LoginAttemptCounter {
  readonly #logger = new Logger(RedisLoginAttemptCounter.name);

  constructor(private readonly redis: Redis) {}

  async registerFailure(
    userId: UserId,
  ): Promise<Result<number, ServiceBusyError>> {
    try {
      const count: unknown = await this.redis.eval(
        REGISTER_FAILURE_SCRIPT,
        1,
        this.key(userId),
        WINDOW_SECONDS,
      );
      if (typeof count !== 'number')
        throw new Error('Unexpected failure counter reply');
      return ok(count);
    } catch (error) {
      return this.unavailable(error);
    }
  }

  async reset(userId: UserId): Promise<Result<void, ServiceBusyError>> {
    try {
      await this.redis.del(this.key(userId));
      return ok(undefined);
    } catch (error) {
      return this.unavailable(error);
    }
  }

  private key(userId: UserId): string {
    return `login:fail:${userId}`;
  }

  private unavailable(error: unknown): Result<never, ServiceBusyError> {
    this.#logger.warn(
      `Login attempt counter unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return err(new ServiceBusyError(RETRY_AFTER_SECONDS));
  }
}
