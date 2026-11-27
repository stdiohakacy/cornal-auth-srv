/**
 * Time units as milliseconds, the unit of `Date` and of every `*Ms` value in this codebase.
 * Seconds appear only at the edges (JWT claims, cookies, env vars): convert there, with these.
 */
export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const seconds = (count: number): number => count * SECOND_MS;
export const minutes = (count: number): number => count * MINUTE_MS;
export const hours = (count: number): number => count * HOUR_MS;
export const days = (count: number): number => count * DAY_MS;

/** Exact conversion, for whole-second spans (`inSeconds(days(14))`). */
export const inSeconds = (ms: number): number => ms / SECOND_MS;

/** Rounded up and never negative: a retry-after that is never too short. */
export const ceilSeconds = (ms: number): number =>
  Math.max(0, Math.ceil(ms / SECOND_MS));

/** NumericDate of JWT claims (RFC 7519): whole seconds since the epoch. */
export const toEpochSeconds = (date: Date): number =>
  Math.floor(date.getTime() / SECOND_MS);
export const fromEpochSeconds = (epochSeconds: number): Date =>
  new Date(epochSeconds * SECOND_MS);

/** Whole seconds from `from` until `to`, never negative (e.g. a cookie Max-Age). */
export const secondsUntil = (from: Date, to: Date): number =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / SECOND_MS));
