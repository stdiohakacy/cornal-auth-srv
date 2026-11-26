import { argon2, argon2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

/** OWASP 2025 baseline for Argon2id: m=19 MiB, t=2, p=1. */
const PARAMS = {
  memory: 19_456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
} as const;

/**
 * Raw Argon2id adapter (wrapped by GatedPasswordHasher for admission control). Uses Node 24's built-in
 * `crypto.argon2`: zero dependencies, async (libuv threadpool), no native build step.
 * Encoded as a PHC string so parameters can be upgraded later (`needsRehash`).
 */
export class Argon2PasswordHasher {
  constructor(private readonly pepper?: Buffer) {}

  async hash(plain: string): Promise<string> {
    const nonce = randomBytes(16);
    const tag = await this.derive(plain, nonce, PARAMS);
    return encodePhc(nonce, tag);
  }

  async verify(plain: string, encoded: string): Promise<boolean> {
    const parsed = parsePhc(encoded);
    if (parsed === undefined) return false;
    const actual = await this.derive(plain, parsed.nonce, {
      ...parsed.params,
      tagLength: parsed.tag.length,
    });
    return (
      actual.length === parsed.tag.length && timingSafeEqual(actual, parsed.tag)
    );
  }

  needsRehash(encoded: string): boolean {
    const parsed = parsePhc(encoded);
    return (
      parsed === undefined ||
      parsed.params.memory < PARAMS.memory ||
      parsed.params.passes < PARAMS.passes ||
      parsed.params.parallelism !== PARAMS.parallelism
    );
  }

  private derive(
    plain: string,
    nonce: Buffer,
    params: {
      memory: number;
      passes: number;
      parallelism: number;
      tagLength: number;
    },
  ): Promise<Buffer> {
    return argon2Async('argon2id', {
      message: plain,
      nonce,
      ...params,
      ...(this.pepper ? { secret: this.pepper } : {}),
    });
  }
}

type ParsedPhc = {
  params: { memory: number; passes: number; parallelism: number };
  nonce: Buffer;
  tag: Buffer;
};

function parsePhc(encoded: string): ParsedPhc | undefined {
  // $argon2id$v=19$m=19456,t=2,p=1$<nonce>$<tag>
  const [, algorithm, version, paramList, nonce, tag] = encoded.split('$');
  if (
    algorithm !== 'argon2id' ||
    version !== 'v=19' ||
    !paramList ||
    !nonce ||
    !tag
  )
    return undefined;
  const params = new Map(
    paramList.split(',').map((pair) => pair.split('=') as [string, string]),
  );
  const memory = Number(params.get('m'));
  const passes = Number(params.get('t'));
  const parallelism = Number(params.get('p'));
  if (![memory, passes, parallelism].every(Number.isSafeInteger))
    return undefined;
  return {
    params: { memory, passes, parallelism },
    nonce: Buffer.from(nonce, 'base64url'),
    tag: Buffer.from(tag, 'base64url'),
  };
}

function encodePhc(nonce: Buffer, tag: Buffer): string {
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${nonce.toString('base64url')}$${tag.toString('base64url')}`;
}

/**
 * Hash of a random, discarded secret. Verifying unknown emails against it costs the same as a
 * real verification, so response time does not reveal whether an account exists.
 * Computed once at startup (one synchronous Argon2 run).
 */
export const DUMMY_PASSWORD_HASH: string = (() => {
  const nonce = randomBytes(16);
  const tag = argon2Sync('argon2id', {
    message: randomBytes(32),
    nonce,
    ...PARAMS,
  });
  return encodePhc(nonce, tag);
})();
