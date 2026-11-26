import { createHash, randomBytes } from 'node:crypto';
import type { SecretTokenGenerator } from '../application/ports.js';

/** 256-bit random tokens; only the sha256 digest is ever stored. */
export class NodeSecretTokenGenerator implements SecretTokenGenerator {
  generate(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: this.hash(raw) };
  }

  hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
