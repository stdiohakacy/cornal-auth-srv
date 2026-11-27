import { html, type SafeHtml } from '@nestjs/mail';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '#src/shared/domain/duration.js';
import type { EmailMessage } from '../application/ports.js';

export type RenderedEmail = {
  readonly subject: string;
  readonly html: SafeHtml;
  readonly text: string;
};

type Copy = {
  subject: string;
  heading: string;
  body: string;
  action: string;
  footer: string;
};

type Data = EmailMessage['data'];

const DURATION = new Intl.DurationFormat('en', { style: 'long' });

/** Minutes below an hour, hours up to two days, days beyond (24 h reads "24 hours"). */
function formatDuration(ms: number): string {
  if (ms < HOUR_MS)
    return DURATION.format({ minutes: Math.round(ms / MINUTE_MS) });
  if (ms <= 2 * DAY_MS)
    return DURATION.format({ hours: Math.round(ms / HOUR_MS) });
  return DURATION.format({ days: Math.round(ms / DAY_MS) });
}

const expiry = (subject: string, { expiresInMs }: Data): string =>
  expiresInMs === undefined
    ? `${subject} expires soon`
    : `${subject} expires in ${formatDuration(expiresInMs)}`;

const orgOr = ({ orgName }: Data, fallback: string): string =>
  orgName ?? fallback;

/** One copy builder per template; the Record type makes a missing template a compile error. */
const COPY: Record<EmailMessage['template'], (data: Data) => Copy> = {
  'verify-email': (data) => ({
    subject: 'Verify your email address',
    heading: 'Confirm your email',
    body: 'Confirm this address to finish setting up your Cornal account.',
    action: 'Verify email',
    footer: `${expiry('The link', data)}. If you did not create an account, ignore this email.`,
  }),
  'account-exists': () => ({
    subject: 'You already have a Cornal account',
    heading: 'Someone tried to sign up with this email',
    body: 'An account with this address already exists. If it was you, sign in instead.',
    action: 'Sign in',
    footer:
      'If this was not you, no action is needed: no new account was created.',
  }),
  'password-reset': (data) => ({
    subject: 'Reset your password',
    heading: 'Reset your password',
    body: 'We received a request to reset the password of your Cornal account.',
    action: 'Choose a new password',
    footer: `${expiry('The link', data)} and works once. If you did not ask for it, ignore this email.`,
  }),
  'password-changed': () => ({
    subject: 'Your password was changed',
    heading: 'Your password was changed',
    body: 'The password of your Cornal account was just changed and every session was signed out.',
    action: 'Sign in',
    footer:
      'If you did not do this, reset your password immediately and contact support.',
  }),
  'org-invitation': (data) => ({
    subject: `You are invited to join ${orgOr(data, 'an organization')} on Cornal`,
    heading: `Join ${orgOr(data, 'the organization')}`,
    body: `You have been invited to join ${orgOr(data, 'an organization')} on Cornal. Sign in or create an account with this email address, then accept the invitation.`,
    action: 'Accept invitation',
    footer: `${expiry('The invitation', data)} and works once. If you were not expecting it, ignore this email.`,
  }),
};

/** Pure rendering: every interpolated value is HTML-escaped by `html```. */
export function renderEmail(message: EmailMessage): RenderedEmail {
  const copy = COPY[message.template](message.data);
  const { link } = message.data;
  return {
    subject: copy.subject,
    html: html`<!doctype html>
      <html>
        <body style="font-family: sans-serif; line-height: 1.5">
          <h1 style="font-size: 20px">${copy.heading}</h1>
          <p>${copy.body}</p>
          <p><a href="${link}">${copy.action}</a></p>
          <p style="color: #666; font-size: 13px">${copy.footer}</p>
          <p style="color: #666; font-size: 13px">Sent to ${message.to}</p>
        </body>
      </html>`,
    text: `${copy.heading}\n\n${copy.body}\n\n${copy.action}: ${link}\n\n${copy.footer}\n`,
  };
}
