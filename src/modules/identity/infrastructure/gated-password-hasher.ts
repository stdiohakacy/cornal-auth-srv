import { err, ok, type Result } from '../../../shared/domain/result.js';
import { ServiceBusyError } from '../../../shared/domain/service-busy.error.js';
import type { HashAdmissionGate } from '../../../shared/infrastructure/hash-admission-gate.js';
import type { PasswordHasher } from '../application/ports.js';
import type { Argon2PasswordHasher } from './argon2-password-hasher.js';

const RETRY_AFTER_SECONDS = 1;

/** Argon2 behind the admission gate: bounded CPU per pod, fast 503 instead of a latency spiral. */
export class GatedPasswordHasher implements PasswordHasher {
  constructor(
    private readonly inner: Argon2PasswordHasher,
    private readonly gate: HashAdmissionGate,
  ) {}

  async hash(plain: string): Promise<Result<string, ServiceBusyError>> {
    const encoded = await this.gate.run(() => this.inner.hash(plain));
    return encoded === undefined
      ? err(new ServiceBusyError(RETRY_AFTER_SECONDS))
      : ok(encoded);
  }

  async verify(
    plain: string,
    encoded: string,
  ): Promise<Result<boolean, ServiceBusyError>> {
    const valid = await this.gate.run(() => this.inner.verify(plain, encoded));
    return valid === undefined
      ? err(new ServiceBusyError(RETRY_AFTER_SECONDS))
      : ok(valid);
  }

  needsRehash(encoded: string): boolean {
    return this.inner.needsRehash(encoded);
  }
}
