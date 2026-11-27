import type { TestingModule } from '@nestjs/testing';
import {
  EMAIL_SENDER,
  type EmailSender,
} from '../../src/modules/identity/application/ports.js';
import { IdentityCoreModule } from '../../src/modules/identity/identity-core.module.js';
import { ClockModule } from '../../src/shared/infrastructure/clock.module.js';
import { AppMailModule } from '../../src/shared/infrastructure/mail/mail.module.js';
import { RedisModule } from '../../src/shared/infrastructure/redis/redis.module.js';
import { findMailTo, MAILPIT_SMTP_URL } from './support/mailpit.js';
import { createPersistenceApp } from './support/persistence-app.js';

describe('MailerEmailSender over SMTP (integration)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await createPersistenceApp({
      config: { EMAIL_TRANSPORT: 'smtp', SMTP_URL: MAILPIT_SMTP_URL },
      imports: [ClockModule, RedisModule, AppMailModule, IdentityCoreModule],
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('delivers verify-email over SMTP to Mailpit with subject and link', async () => {
    const to = `smtp-${Date.now()}@test.local`;
    const link =
      'http://localhost:3000/verify-email?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

    await moduleRef
      .get<EmailSender>(EMAIL_SENDER)
      .send({ to, template: 'verify-email', data: { link } });

    const mail = await findMailTo(to);
    expect(mail?.From.Address).toBe('no-reply@cornal.local');
    expect(mail?.Subject).toMatch(/verify/i);
    expect(mail?.HTML).toContain(link);
    expect(mail?.Text).toContain(link);
  });
});
