import { Controller, Get, Header, Inject } from '@nestjs/common';
import type { JWK } from 'jose';
import { KEY_RING } from '../infrastructure/key-ring.provider.js';
import type { KeyRing } from '../infrastructure/key-ring.js';

/** Public keys for local verification by the gateway, authz-agent and other services. */
@Controller('.well-known')
export class JwksController {
  constructor(@Inject(KEY_RING) private readonly keys: KeyRing) {}

  @Get('jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  jwks(): { keys: JWK[] } {
    return this.keys.jwks();
  }
}
