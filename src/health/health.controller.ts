import {
  Controller,
  Get,
  Inject,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
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

  /**
   * Readiness: every registered dependency answers in time. 503 takes the pod out of rotation.
   * The terminus body is returned as-is (not problem+json) because orchestrators and dashboards
   * read `info` / `error` per dependency.
   */
  @Get('ready')
  @HealthCheck()
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthCheckResult | string | object> {
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
    try {
      return await this.health.check(checks);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      res.status(error.getStatus());
      return error.getResponse();
    }
  }
}
