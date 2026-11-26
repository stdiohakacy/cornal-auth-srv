import { z } from 'zod';
import { err, ok, type Result } from '../shared/domain/result.js';

/** Express `trust proxy` syntax: true | false | hop count | comma-separated names/CIDRs. */
const trustProxy = z
  .string()
  .default('loopback')
  .transform((raw): boolean | number | string => {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (/^\d+$/.test(raw)) return Number(raw);
    return raw;
  });

export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  APP_ROLE: z.enum(['login', 'api', 'worker']).default('api'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  /** Which upstream proxies may set X-Forwarded-For. Never `true` behind an untrusted edge. */
  TRUST_PROXY: trustProxy,
  /** Through PgBouncer (transaction pooling). Used by the app at runtime. */
  DATABASE_URL: z.url(),
  /** Straight to PostgreSQL. Migrations and session-level features only. */
  DATABASE_DIRECT_URL: z.url(),
  DATABASE_REPLICA_URL: z.url().optional(),
  /** Per-pod pool size. Keep small: PgBouncer multiplexes onto ~40 server connections. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  /** Disable only in tests or in a consumer-only deployment. */
  OUTBOX_RELAY_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  REDIS_URL: z.url(),
  NATS_URL: z.url(),
});

export type AppConfig = Readonly<z.infer<typeof EnvSchema>>;
export type AppRole = AppConfig['APP_ROLE'];

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Parse once at boot. Reports every issue at the same time, never only the first. */
export function parseConfig(
  env: Readonly<Record<string, string | undefined>>,
): Result<AppConfig, string> {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) return err(z.prettifyError(parsed.error));
  return ok(Object.freeze(parsed.data));
}
