import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import { HOUR_MS, MINUTE_MS, minutes } from '#src/shared/domain/duration.js';

type Limit = { readonly limit: number; readonly ttl: number };

/** Per-route limits (CORNAL plan, Phase 3a). Routes opt in with @Throttle(RATE_LIMITS.x). */
export const RATE_LIMITS = {
  register: {
    ip: { limit: 10, ttl: HOUR_MS },
    email: { limit: 3, ttl: HOUR_MS },
  },
  verifyEmail: { ip: { limit: 30, ttl: minutes(15) } },
  forgotPassword: {
    ip: { limit: 10, ttl: HOUR_MS },
    email: { limit: 3, ttl: HOUR_MS },
  },
  resetPassword: { ip: { limit: 20, ttl: minutes(15) } },
  refresh: { ip: { limit: 60, ttl: MINUTE_MS } },
  meSessions: { ip: { limit: 120, ttl: MINUTE_MS } },
  changePassword: { ip: { limit: 10, ttl: HOUR_MS } },
  login: {
    ip: { limit: 20, ttl: MINUTE_MS },
    email: { limit: 10, ttl: minutes(15) },
    ipEmail: { limit: 5, ttl: MINUTE_MS },
  },
} as const satisfies Record<string, Partial<Record<ThrottlerName, Limit>>>;

export type ThrottlerName = 'ip' | 'email' | 'ipEmail';

type RequestLike = { ip?: string | undefined; body?: unknown };

/** Normalized email from an unvalidated body (guards run before validation pipes). */
function emailOf(req: RequestLike): string | undefined {
  const body = req.body;
  if (typeof body !== 'object' || body === null || !('email' in body))
    return undefined;
  const email = body.email;
  return typeof email === 'string' && email.trim() !== ''
    ? email.trim().toLowerCase()
    : undefined;
}

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const ipOf = (req: RequestLike): string => req.ip ?? 'unknown';
const hasNoEmail = (context: ExecutionContext): boolean =>
  emailOf(context.switchToHttp().getRequest<RequestLike>()) === undefined;

/**
 * Three counters per request: client IP, the email being targeted (credential stuffing from many
 * IPs) and the pair. Defaults are generous; sensitive routes tighten them with @Throttle.
 */
export const THROTTLERS: ThrottlerOptions[] = [
  {
    name: 'ip',
    limit: 300,
    ttl: MINUTE_MS,
    getTracker: (req: RequestLike) => ipOf(req),
  },
  {
    name: 'email',
    limit: 100,
    ttl: MINUTE_MS,
    skipIf: hasNoEmail,
    getTracker: (req: RequestLike) => sha256(emailOf(req) ?? ''),
  },
  {
    name: 'ipEmail',
    limit: 100,
    ttl: MINUTE_MS,
    skipIf: hasNoEmail,
    getTracker: (req: RequestLike) =>
      `${ipOf(req)}|${sha256(emailOf(req) ?? '')}`,
  },
];
