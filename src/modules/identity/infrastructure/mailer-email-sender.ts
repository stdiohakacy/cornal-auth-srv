import type { Mailer } from '@nestjs/mail';
import type { EmailMessage, EmailSender } from '../application/ports.js';
import { renderEmail } from './email-templates.js';

/** Sends through @nestjs/mail (SMTP in production, Mailpit in development). Throws on failure. */
export class MailerEmailSender implements EmailSender {
  constructor(private readonly mailer: Mailer) {}

  async send(message: EmailMessage): Promise<void> {
    await this.mailer.send({ to: message.to, ...renderEmail(message) });
  }
}
