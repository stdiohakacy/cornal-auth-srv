import { randomUUIDv7 } from 'node:crypto';
import type { LoggerOptions } from 'pino';
import type { Options } from 'pino-http';
import type { AppConfig } from '../../../config/env.schema.js';
import type { RequestContext } from '../request-context/request-context.js';

/** Secrets that must never reach a log line, whatever object they appear in. */
export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.query.code',
  '*.password',
  '*.token',
  '*.refreshToken',
  '*.otp',
  '*.recoveryCode',
];

/** Query keys whose values are one-time secrets (OAuth authorization code, reset tokens). */
const SENSITIVE_QUERY_KEYS: readonly string[] = ['code', 'token'];

/** `req.url` carries the raw query string, which `redact` paths cannot reach. */
export function redactUrl(url: string | undefined): string | undefined {
  if (url === undefined || !url.includes('?')) return url;
  const parsed = new URL(url, 'http://placeholder.invalid');
  for (const key of SENSITIVE_QUERY_KEYS) {
    if (parsed.searchParams.has(key))
      parsed.searchParams.set(key, '[Redacted]');
  }
  return `${parsed.pathname}${parsed.search}`;
}

export function pinoBaseOptions(config: AppConfig): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    redact: { paths: [...REDACT_PATHS], censor: '[Redacted]' },
  };
}

/** pino-http options: one log line per request, correlated with the ALS request id. */
export function buildPinoHttpOptions(
  config: AppConfig,
  ctx: RequestContext,
): Options {
  return {
    ...pinoBaseOptions(config),
    genReqId: () => ctx.current()?.requestId ?? randomUUIDv7(),
    customProps: () => ({ requestId: ctx.current()?.requestId }),
    serializers: {
      req: (req: { url?: string }) => ({ ...req, url: redactUrl(req.url) }),
    },
    autoLogging: {
      ignore: (req) => req.url?.startsWith('/health') ?? false,
    },
  };
}
