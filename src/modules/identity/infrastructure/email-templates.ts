import { html, type SafeHtml } from '@nestjs/mail';
import { assertNever } from '../../../shared/domain/guard.js';
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

function copyFor({ template, data }: EmailMessage): Copy {
  switch (template) {
    case 'verify-email':
      return {
        subject: 'Verify your email address',
        heading: 'Confirm your email',
        body: 'Confirm this address to finish setting up your Cornal account.',
        action: 'Verify email',
        footer:
          'The link expires in 24 hours. If you did not create an account, ignore this email.',
      };
    case 'account-exists':
      return {
        subject: 'You already have a Cornal account',
        heading: 'Someone tried to sign up with this email',
        body: 'An account with this address already exists. If it was you, sign in instead.',
        action: 'Sign in',
        footer:
          'If this was not you, no action is needed: no new account was created.',
      };
    case 'password-reset':
      return {
        subject: 'Reset your password',
        heading: 'Reset your password',
        body: 'We received a request to reset the password of your Cornal account.',
        action: 'Choose a new password',
        footer:
          'The link expires in 30 minutes and works once. If you did not ask for it, ignore this email.',
      };
    case 'password-changed':
      return {
        subject: 'Your password was changed',
        heading: 'Your password was changed',
        body: 'The password of your Cornal account was just changed and every session was signed out.',
        action: 'Sign in',
        footer:
          'If you did not do this, reset your password immediately and contact support.',
      };
    case 'org-invitation':
      return {
        subject: `You are invited to join ${data.orgName ?? 'an organization'} on Cornal`,
        heading: `Join ${data.orgName ?? 'the organization'}`,
        body: `You have been invited to join ${data.orgName ?? 'an organization'} on Cornal. Sign in or create an account with this email address, then accept the invitation.`,
        action: 'Accept invitation',
        footer:
          'The invitation expires in 7 days and works once. If you were not expecting it, ignore this email.',
      };
    default:
      return assertNever(template);
  }
}

/** Pure rendering: every interpolated value is HTML-escaped by `html```. */
export function renderEmail(message: EmailMessage): RenderedEmail {
  const copy = copyFor(message);
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
