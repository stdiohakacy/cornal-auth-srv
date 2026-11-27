import {
  readRefreshCookie,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
} from './refresh-cookie.js';

describe('refresh cookie', () => {
  it('finds cornal_rt among other cookies; absent → undefined', () => {
    expect(
      readRefreshCookie(`theme=dark; ${REFRESH_COOKIE_NAME}=abc.def; other=1`),
    ).toBe('abc.def');
    expect(readRefreshCookie('theme=dark')).toBeUndefined();
    expect(readRefreshCookie(undefined)).toBeUndefined();
  });

  it('is HttpOnly, Secure, SameSite=Strict and scoped to /auth', () => {
    expect(refreshCookieOptions(3600)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/auth',
      maxAge: 3_600_000,
    });
  });
});
