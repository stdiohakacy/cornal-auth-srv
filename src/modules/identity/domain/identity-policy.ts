import { days, hours, minutes } from '#src/shared/domain/duration.js';

/**
 * Identity security policy in one place. Deliberately code, not env: changing it goes through
 * review. Durations are milliseconds (see shared/domain/duration.ts).
 */
export const IDENTITY_POLICY = {
  password: {
    /** NIST SP 800-63B minimum for user-chosen passwords. */
    minLength: 12,
    /** Caps Argon2 work per request (and the size of what we hash). */
    maxLength: 256,
  },
  lockout: {
    /** The N-th failed password proof inside the window locks the account. */
    maxFailures: 5,
    /** Failures older than this no longer count. */
    failureWindowMs: minutes(15),
    lockDurationMs: minutes(15),
  },
  /** Lifetimes of single-use emailed tokens. */
  tokenTtlMs: {
    emailVerification: hours(24),
    passwordReset: minutes(30),
    orgInvitation: days(7),
  },
} as const;
