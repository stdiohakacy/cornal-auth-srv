import { z } from 'zod';
import { err, ok, type Result } from '../shared/domain/result.js';

/** `[{ "kid": "...", "pem": "-----BEGIN PRIVATE KEY-----..." }]`: index 0 signs, all are published. */
const SigningKeysSchema = z
  .string()
  .transform((raw, ctx): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'JWT_SIGNING_KEYS must be JSON',
      });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(
        z.strictObject({
          kid: z.string().min(1).max(64),
          pem: z.string().startsWith('-----BEGIN PRIVATE KEY-----'),
        }),
      )
      .min(1),
  );

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

export const EnvSchema = z
  .object({
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
    /** Base URL of the frontend page that receives `?token=` from the verification email. */
    EMAIL_VERIFICATION_URL: z
      .url()
      .default('http://localhost:3000/verify-email'),
    /** Frontend login page, linked from the "account already exists" email. */
    APP_LOGIN_URL: z.url().default('http://localhost:3000/login'),
    /** Frontend page that receives `?token=` from the password-reset email. */
    PASSWORD_RESET_URL: z.url().default('http://localhost:3000/reset-password'),
    /** Frontend page that receives `?token=` from an organization invitation email. */
    ORG_INVITATION_URL: z
      .url()
      .default('http://localhost:3000/accept-invitation'),
    /** `log` prints emails (with their secret links) to the log: development only. */
    EMAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),
    /** e.g. smtps://user:pass@smtp.provider.com:465 or smtp://localhost:1025 (Mailpit). */
    SMTP_URL: z.url().optional(),
    EMAIL_FROM: z.string().min(3).default('Cornal <no-reply@cornal.local>'),
    /** Concurrent Argon2 jobs per pod; defaults to the number of CPUs. */
    HASH_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(256).optional(),
    /** Read by libuv at process start (Argon2 runs on its threadpool). Declared here so the gate can match it. */
    UV_THREADPOOL_SIZE: z.coerce.number().int().min(1).max(1024).optional(),
    /** Optional server-side secret mixed into Argon2 (from a secret manager in production). */
    PASSWORD_PEPPER: z.string().min(32).optional(),
    /** Screen new passwords against HIBP (k-anonymity). Disable where outbound HTTP is not allowed. */
    PASSWORD_BREACH_CHECK: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    /** ES256 (P-256) PKCS#8 keys. Optional outside production: an ephemeral key is generated. */
    JWT_SIGNING_KEYS: SigningKeysSchema.optional(),
    JWT_ISSUER: z.url().default('http://localhost:3001'),
    JWT_AUDIENCE: z.string().min(1).default('cornal-platform'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(900)
      .default(600),
    /** Sliding: each refresh extends it, never past the absolute expiry. */
    REFRESH_IDLE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(14 * 24 * 3600),
    REFRESH_ABSOLUTE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(30 * 24 * 3600),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.JWT_SIGNING_KEYS === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SIGNING_KEYS'],
        message:
          'JWT_SIGNING_KEYS is required in production (ephemeral keys break every token on restart)',
      });
    }
    if (env.REFRESH_ABSOLUTE_TTL_SECONDS < env.REFRESH_IDLE_TTL_SECONDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['REFRESH_ABSOLUTE_TTL_SECONDS'],
        message:
          'REFRESH_ABSOLUTE_TTL_SECONDS must be at least REFRESH_IDLE_TTL_SECONDS',
      });
    }
    if (env.NODE_ENV === 'production' && env.EMAIL_TRANSPORT === 'log') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_TRANSPORT'],
        message:
          'The log transport writes secret links to logs; configure a real provider in production',
      });
    }
    if (env.EMAIL_TRANSPORT === 'smtp' && env.SMTP_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message: 'SMTP_URL is required when EMAIL_TRANSPORT=smtp',
      });
    }
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
