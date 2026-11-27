import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { BreachedPasswordChecker } from '../application/ports.js';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';

/**
 * Pwned Passwords range API with k-anonymity: only the first 5 hex chars of SHA-1(password) leave
 * the server, and `Add-Padding` hides the true size of the answer. Fails open on any error.
 */
export class HibpBreachedPasswordChecker implements BreachedPasswordChecker {
  readonly #logger = new Logger(HibpBreachedPasswordChecker.name);

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 1000,
  ) {}

  async isBreached(plain: string): Promise<boolean> {
    const digest = createHash('sha1').update(plain).digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    try {
      const response = await this.fetchFn(`${RANGE_URL}${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'cornal-auth-srv' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`HIBP answered ${response.status}`);
      return (await response.text()).split('\n').some((line) => {
        const [candidate, count] = line.trim().split(':');
        return candidate === suffix && Number(count) > 0;
      });
    } catch (error) {
      this.#logger.warn(
        `Breach check skipped (fail-open): ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}

/** Used when PASSWORD_BREACH_CHECK=false. */
export class NeverBreachedChecker implements BreachedPasswordChecker {
  async isBreached(): Promise<boolean> {
    return false;
  }
}
