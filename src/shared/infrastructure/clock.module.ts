import { Global, Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../application/ports.js';

const systemClock: Clock = { now: () => new Date() };

/** Wall clock for use cases; tests inject a fixed Clock instead of faking timers. */
@Global()
@Module({
  providers: [{ provide: CLOCK, useValue: systemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
