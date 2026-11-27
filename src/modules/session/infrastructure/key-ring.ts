import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUIDv7,
} from 'node:crypto';
import { Logger } from '@nestjs/common';
import { createLocalJWKSet, exportJWK, importPKCS8, type JWK } from 'jose';
import { InvariantViolation } from '../../../shared/domain/domain-error.js';

export type SigningKeyConfig = { readonly kid: string; readonly pem: string };
type Signer = { readonly kid: string; readonly key: CryptoKey };

const ALG = 'ES256';

/**
 * ES256 signing keys. The first key signs; every key stays in the JWKS so tokens signed before a
 * rotation keep verifying until they expire.
 */
export class KeyRing {
  readonly verificationKeys: ReturnType<typeof createLocalJWKSet>;

  private constructor(
    readonly signer: Signer,
    private readonly publicJwks: readonly JWK[],
  ) {
    this.verificationKeys = createLocalJWKSet({ keys: [...publicJwks] });
  }

  static async fromConfig(
    keys: readonly SigningKeyConfig[] | undefined,
    nodeEnv: 'development' | 'test' | 'production',
  ): Promise<KeyRing> {
    const configured = keys ?? KeyRing.ephemeral(nodeEnv);
    const entries = await Promise.all(
      configured.map((entry) => KeyRing.load(entry)),
    );
    const [first] = entries;
    if (!first)
      throw new InvariantViolation('At least one signing key is required');
    return new KeyRing(
      { kid: first.kid, key: first.privateKey },
      entries.map((entry) => entry.publicJwk),
    );
  }

  /** Public keys only, as served at /.well-known/jwks.json. */
  jwks(): { keys: JWK[] } {
    return { keys: this.publicJwks.map((jwk) => ({ ...jwk })) };
  }

  private static ephemeral(nodeEnv: string): SigningKeyConfig[] {
    if (nodeEnv === 'production') {
      throw new InvariantViolation(
        'JWT_SIGNING_KEYS is required in production',
      );
    }
    const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString();
    const kid = `ephemeral-${randomUUIDv7().slice(0, 8)}`;
    new Logger(KeyRing.name).warn(
      `No JWT_SIGNING_KEYS: using ephemeral key ${kid}; tokens become invalid on restart`,
    );
    return [{ kid, pem }];
  }

  private static async load(entry: SigningKeyConfig) {
    const keyObject = createPrivateKey(entry.pem);
    if (
      keyObject.asymmetricKeyType !== 'ec' ||
      keyObject.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    ) {
      throw new InvariantViolation(
        `Signing key ${entry.kid} must be an EC P-256 key for ES256`,
      );
    }
    const publicJwk = await exportJWK(createPublicKey(keyObject));
    return {
      kid: entry.kid,
      privateKey: await importPKCS8(entry.pem, ALG),
      publicJwk: {
        ...publicJwk,
        kid: entry.kid,
        alg: ALG,
        use: 'sig',
      } satisfies JWK,
    };
  }
}
