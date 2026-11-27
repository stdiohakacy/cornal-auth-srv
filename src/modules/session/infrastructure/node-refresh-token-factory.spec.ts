import type { SessionId } from '../domain/session.js';
import { NodeRefreshTokenFactory } from './node-refresh-token-factory.js';

const SID = '01a21877-9b5a-7147-b111-fa795f1f2ee1' as SessionId;

describe('NodeRefreshTokenFactory', () => {
  const factory = new NodeRefreshTokenFactory();

  it('format/parse round-trip; only the hash of the secret is exposed', () => {
    const { secret, hash } = factory.newSecret();
    const raw = factory.format(SID, secret);

    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(factory.parse(raw)).toEqual({ sessionId: SID, hash });
  });

  it('garbage → undefined', () => {
    for (const raw of [
      '',
      'no-dot',
      `${SID}.`,
      `not-a-uuid.${'a'.repeat(43)}`,
      `${SID}.short`,
      `${SID}.${'a'.repeat(43)}.x`,
    ]) {
      expect(factory.parse(raw)).toBeUndefined();
    }
  });
});
