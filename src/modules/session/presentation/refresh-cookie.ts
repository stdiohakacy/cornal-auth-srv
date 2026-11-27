import type { CookieOptions } from 'express';
import { seconds } from '#src/shared/domain/duration.js';

export const REFRESH_COOKIE_NAME = 'cornal_rt';

/** Attributes shared by set and clear: browsers only clear a cookie whose path/flags match. */
export const READ_REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/auth',
};

/** Scoped to /auth so the refresh token is never sent to API routes, and unreadable by scripts. */
export function refreshCookieOptions(maxAgeSeconds: number): CookieOptions {
  return { ...READ_REFRESH_COOKIE_OPTIONS, maxAge: seconds(maxAgeSeconds) };
}

/** Minimal Cookie-header reader for our one cookie (no cookie-parser dependency). */
export function readRefreshCookie(
  header: string | undefined,
): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (
      separator > 0 &&
      part.slice(0, separator).trim() === REFRESH_COOKIE_NAME
    ) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}
