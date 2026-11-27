import { createHash, randomBytes } from 'node:crypto';
import { parseId } from '#src/shared/domain/id.js';
import type { RefreshTokenFactory } from '../application/ports.js';
import type { SessionId } from '../domain/session.js';

const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export class NodeRefreshTokenFactory implements RefreshTokenFactory {
  newSecret(): { secret: string; hash: string } {
    const secret = randomBytes(32).toString('base64url');
    return { secret, hash: sha256(secret) };
  }

  format(sessionId: SessionId, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  parse(raw: string): { sessionId: SessionId; hash: string } | undefined {
    const parts = raw.split('.');
    if (parts.length !== 2) return undefined;
    const [sid, secret] = parts;
    if (
      sid === undefined ||
      secret === undefined ||
      !SECRET_PATTERN.test(secret)
    )
      return undefined;
    const sessionId = parseId<'Session'>(sid);
    return sessionId ? { sessionId, hash: sha256(secret) } : undefined;
  }
}
