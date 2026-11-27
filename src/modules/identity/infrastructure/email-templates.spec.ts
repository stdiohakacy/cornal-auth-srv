import type { EmailTemplate } from '../application/ports.js';
import { renderEmail } from './email-templates.js';

const TEMPLATES: EmailTemplate[] = [
  'verify-email',
  'account-exists',
  'password-reset',
  'password-changed',
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
});
