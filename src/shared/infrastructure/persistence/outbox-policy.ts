import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { OutboxEvents, type OutboxRetryOptions } from '@nestjs/outbox';
import { filter, type Subscription } from 'rxjs';

/**
 * Delivery policy, stated explicitly instead of relying on library defaults.
 * A message whose topic has no handler (yet) is retried like any failure: rolling deploys may
 * ship the producer before the consumer. After OUTBOX_RETRY_ATTEMPTS it is dead-lettered and
 * reported at error level; `OutboxDeadLetters.requeue()` replays it once a consumer exists.
 */
export const OUTBOX_RETRY_ATTEMPTS = 20;

export const OUTBOX_RETRY: OutboxRetryOptions = {
  attempts: OUTBOX_RETRY_ATTEMPTS,
  backoff: { delay: '1s', maxDelay: '10m', jitter: 'full' },
};

/** Turns every dead-lettered message into an error log line (alerting hooks on level=error). */
@Injectable()
export class OutboxDeadLetterAlerts implements OnModuleInit, OnModuleDestroy {
  readonly #logger = new Logger(OutboxDeadLetterAlerts.name);
  #subscription: Subscription | undefined;

  constructor(private readonly events: OutboxEvents) {}

  onModuleInit(): void {
    this.#subscription = this.events.events$
      .pipe(filter((event) => event.type === 'dead-lettered'))
      .subscribe((event) => {
        if (event.type !== 'dead-lettered') return;
        this.#logger.error(
          `Outbox message dead-lettered: topic=${event.message.topic} id=${event.message.id} ` +
            `reason=${event.reason} attempts=${event.attempt}`,
        );
      });
  }

  onModuleDestroy(): void {
    this.#subscription?.unsubscribe();
  }
}
