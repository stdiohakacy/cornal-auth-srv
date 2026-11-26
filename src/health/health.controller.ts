import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  type HealthCheckResult,
} from '@nestjs/terminus';
import {
  APP_CONFIG,
  type AppConfig,
  type AppRole,
} from '../config/env.schema.js';
import { ReadinessRegistry } from './readiness.registry.js';

const PROBE_TIMEOUT_MS = 2_000;

@Controller('health')
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly readiness: ReadinessRegistry,
  ) {}

  /** Liveness: the process is up. Never checks dependencies, so a DB outage does not restart pods. */
  @Get()
  check(): { status: 'ok'; role: AppRole } {
    return { status: 'ok', role: this.config.APP_ROLE };
  }

  /** Readiness: every registered dependency answers in time. 503 takes the pod out of rotation. */
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    const checks = [...this.readiness.entries()].map(
      ([name, probe]) =>
        () =>
          this.indicators
            .check(name)
            .attempt(async ({ signal }) => {
              if (!(await probe(signal))) {
                throw new Error(`${name} probe reported not ready`);
              }
            })
            .withTimeout(PROBE_TIMEOUT_MS),
    );
    return this.health.check(checks);
  }
}
