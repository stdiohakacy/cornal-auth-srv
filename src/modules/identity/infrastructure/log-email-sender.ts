import { Logger } from '@nestjs/common';
import type { EmailMessage, EmailSender } from '../application/ports.js';

/**
 * Development transport: writes the email to the log. Refused in production by the config
 * schema because links carry single-use secrets. A real provider arrives in Phase 3b.
 */
export class LogEmailSender implements EmailSender {
  readonly #logger = new Logger('Email');

  async send(message: EmailMessage): Promise<void> {
    this.#logger.log(
      `[${message.template}] to=${message.to} link=${message.data.link}`,
    );
  }
}
