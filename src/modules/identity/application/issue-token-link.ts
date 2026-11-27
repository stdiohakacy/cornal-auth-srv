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

/** `${baseUrl}?token=<raw>`: the only place a raw single-use token leaves memory. */
export function linkWithToken(baseUrl: string, raw: string): string {
  const link = new URL(baseUrl);
  link.searchParams.set('token', raw);
  return link.toString();
}

/**
 * Revokes open tokens of the same purpose, stores the sha256 of a fresh one and emails
 * `${baseUrl}?token=<raw>`. Must run inside the caller's transaction: a failed send rolls the token
 * back. The raw token exists only in memory and in the email.
 */
export async function issueTokenLink(
  deps: TokenLinkDeps,
  request: {
    readonly spec: TokenLinkSpec;
    readonly user: User;
    readonly now: Date;
  },
): Promise<void> {
  const { spec, user, now } = request;
  const { raw, hash } = deps.generator.generate();
  await deps.tokens.revokeOpen(user.id, spec.purpose);
  await deps.tokens.issue({
    purpose: spec.purpose,
    userId: user.id,
    tokenHash: hash,
    expiresAt: new Date(now.getTime() + spec.ttlMs),
  });
  await deps.emails.send({
    to: user.email.value,
    template: spec.template,
    data: { link: linkWithToken(spec.baseUrl, raw), expiresInMs: spec.ttlMs },
  });
}
