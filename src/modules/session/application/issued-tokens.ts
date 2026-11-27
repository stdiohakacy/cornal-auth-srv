/** What login and refresh hand to the presentation layer (cookie vs body is decided there). */
export type IssuedTokens = {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: string;
  /** Seconds until the session's idle expiry: the refresh cookie's Max-Age. */
  readonly refreshMaxAgeSeconds: number;
};

export type SessionTtl = {
  readonly idleSeconds: number;
  readonly absoluteSeconds: number;
};

export const secondsUntil = (from: Date, to: Date): number =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
