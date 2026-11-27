import type { User } from '../domain/user.js';
import type {
  EmailSender,
  EmailTemplate,
  OneTimeTokenRepository,
  SecretTokenGenerator,
  TokenPurpose,
} from './ports.js';

export type TokenLinkDeps = {
  readonly tokens: OneTimeTokenRepository;
  readonly generator: SecretTokenGenerator;
  readonly emails: EmailSender;
};

export type TokenLinkSpec = {
  readonly purpose: TokenPurpose;
  readonly ttlMs: number;
  readonly template: EmailTemplate;
  readonly baseUrl: string;
};

/**
 * Revokes open tokens of the same purpose, stores the sha256 of a fresh one and emails
 * `${baseUrl}?token=<raw>`. Must run inside the caller's transaction: a failed send rolls the token
 * back. The raw token exists only in memory and in the email.
 */
export async function issueTokenLink(
  deps: TokenLinkDeps,
  spec: TokenLinkSpec,
  user: User,
  now: Date,
): Promise<void> {
  const { raw, hash } = deps.generator.generate();
  await deps.tokens.revokeOpen(user.id, spec.purpose);
  await deps.tokens.issue({
    purpose: spec.purpose,
    userId: user.id,
    tokenHash: hash,
    expiresAt: new Date(now.getTime() + spec.ttlMs),
  });
  const link = new URL(spec.baseUrl);
  link.searchParams.set('token', raw);
  await deps.emails.send({
    to: user.email.value,
    template: spec.template,
    data: { link: link.toString() },
  });
}
