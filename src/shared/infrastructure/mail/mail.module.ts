import { Module } from '@nestjs/common';
import { LogMailTransport, MailModule, SmtpTransport } from '@nestjs/mail';
import { APP_CONFIG, type AppConfig } from '../../../config/env.schema.js';
import { InvariantViolation } from '../../domain/domain-error.js';

/**
 * Global Mailer. Delivery retries are left to the outbox (`retry: false`): a failed send fails the
 * consumer, rolls back its transaction and the whole message is retried with backoff.
 */
@Module({
  imports: [
    MailModule.forRootAsync({
      isGlobal: true,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        transport: transportFor(config),
        from: config.EMAIL_FROM,
        retry: false,
      }),
    }),
  ],
})
export class AppMailModule {}

function transportFor(config: AppConfig) {
  if (config.EMAIL_TRANSPORT === 'log')
    return new LogMailTransport({ body: true });
  if (config.SMTP_URL === undefined)
    throw new InvariantViolation('SMTP_URL is required for smtp');
  return new SmtpTransport({ url: config.SMTP_URL });
}
