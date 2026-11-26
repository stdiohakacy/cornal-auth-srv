import { Global, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { ReadinessRegistry } from './readiness.registry.js';

/** Global so every adapter module can inject `ReadinessRegistry` without importing this module. */
@Global()
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [ReadinessRegistry],
  exports: [ReadinessRegistry],
})
export class HealthModule {}
