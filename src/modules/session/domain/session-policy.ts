import { seconds } from '#src/shared/domain/duration.js';

/**
 * Refresh-token rotation policy. Session lifetimes (idle/absolute) are deployment settings and
 * come from env (REFRESH_*_TTL_SECONDS); access-token TTL likewise (ACCESS_TOKEN_TTL_SECONDS).
 */
export const SESSION_POLICY = {
  /** Superseded refresh hashes kept to detect reuse of a stolen, already-rotated token. */
  maxPreviousRefreshHashes: 5,
  /** Two tabs refreshing at once: the loser presents prev[0] moments later. Not theft. */
  rotationGraceMs: seconds(10),
} as const;
