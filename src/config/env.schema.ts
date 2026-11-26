import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  APP_ROLE: z.enum(['login', 'api', 'worker']).default('api'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  /** Through PgBouncer (transaction pooling). Used by the app at runtime. */
  DATABASE_URL: z.url(),
  /** Straight to PostgreSQL. Migrations and session-level features only. */
  DATABASE_DIRECT_URL: z.url(),
  DATABASE_REPLICA_URL: z.url().optional(),
  REDIS_URL: z.url(),
  NATS_URL: z.url(),
});

export type AppConfig = Readonly<z.infer<typeof EnvSchema>>;
export type AppRole = AppConfig['APP_ROLE'];

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Replaced by the shared `Result` from `src/shared/domain/result.ts` in Phase 1. */
export type ConfigResult =
  | { readonly ok: true; readonly value: AppConfig }
  | { readonly ok: false; readonly error: string };

/** Parse once at boot. Reports every issue at the same time, never only the first. */
export function parseConfig(
  env: Readonly<Record<string, string | undefined>>,
): ConfigResult {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success)
    return { ok: false, error: z.prettifyError(parsed.error) };
  return { ok: true, value: Object.freeze(parsed.data) };
}
