import type { EmailTemplate } from '../application/ports.js';
import { renderEmail } from './email-templates.js';

const TEMPLATES: EmailTemplate[] = [
  'verify-email',
  'account-exists',
  'password-reset',
  'password-changed',
  'org-invitation',
];

describe('renderEmail', () => {
  it.each(TEMPLATES)(
    '%s has a subject, html containing the link, and a text alternative',
    (template) => {
      const link = 'https://app.test/path?token=abc_DEF-123';

      const email = renderEmail({ to: 'a@b.co', template, data: { link } });

      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.html.value).toContain(
        'href="https://app.test/path?token=abc_DEF-123"',
      );
      expect(email.text).toContain(link);
    },
  );

  it('escapes markup in the link and recipient', () => {
    const email = renderEmail({
      to: '"><script>alert(1)</script>@b.co',
      template: 'verify-email',
      data: { link: 'https://x.test/?a="><script>alert(2)</script>' },
    });

    expect(email.html.value).not.toContain('<script>');
    expect(email.html.value).toContain('&lt;script&gt;');
  });

  it.each([
    ['verify-email', 24 * 60 * 60 * 1000, 'expires in 24 hours'],
    ['password-reset', 30 * 60 * 1000, 'expires in 30 minutes'],
    ['org-invitation', 7 * 24 * 60 * 60 * 1000, 'expires in 7 days'],
    ['verify-email', 2 * 60 * 60 * 1000, 'expires in 2 hours'],
    ['password-reset', 60 * 1000, 'expires in 1 minute and'],
  ] as const)(
    '%s states the lifetime it was issued with (%d ms)',
    (template, expiresInMs, phrase) => {
      const email = renderEmail({
        to: 'a@b.co',
        template,
        data: { link: 'https://x.test/', expiresInMs },
      });

      expect(email.text).toContain(phrase);
    },
  );

  it('names the organization in an invitation', () => {
    const email = renderEmail({
      to: 'a@b.co',
      template: 'org-invitation',
      data: { link: 'https://x.test/', orgName: 'Acme', expiresInMs: 1000 },
    });

    expect(email.subject).toContain('Acme');
  });
});
