import { createHash } from 'node:crypto';
import { HibpBreachedPasswordChecker } from './hibp-breached-password-checker.js';

const PASSWORD = 'correct-horse-battery';
const sha1 = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase();
const PREFIX = sha1.slice(0, 5);
const SUFFIX = sha1.slice(5);

const respond = (body: string, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(body, { status }));

describe('HibpBreachedPasswordChecker', () => {
  it('sends only the 5-char SHA-1 prefix with Add-Padding and reports a listed suffix as breached', async () => {
    const fetchFn = respond(
      `0000000000000000000000000000000000A:3\r\n${SUFFIX}:42\r\n`,
    );
    const checker = new HibpBreachedPasswordChecker(fetchFn);

    expect(await checker.isBreached(PASSWORD)).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect(new Headers(init?.headers).get('Add-Padding')).toBe('true');
    expect(String(url as string)).not.toContain(SUFFIX);
  });

  it('unlisted suffix → false', async () => {
    const checker = new HibpBreachedPasswordChecker(
      respond('0000000000000000000000000000000000A:3\r\n'),
    );

    expect(await checker.isBreached(PASSWORD)).toBe(false);
  });

  it('padded entry with count 0 → false', async () => {
    const checker = new HibpBreachedPasswordChecker(respond(`${SUFFIX}:0\r\n`));

    expect(await checker.isBreached(PASSWORD)).toBe(false);
  });

  it('HTTP error → false (fail-open)', async () => {
    const checker = new HibpBreachedPasswordChecker(respond('busy', 503));

    expect(await checker.isBreached(PASSWORD)).toBe(false);
  });

  it('timeout → false within ~timeout', async () => {
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const checker = new HibpBreachedPasswordChecker(hanging, 50);
    const started = performance.now();

    expect(await checker.isBreached(PASSWORD)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
