import { Global, Module } from '@nestjs/common';
import { RequestContext } from './request-context.js';

/** One ALS instance per process, injectable everywhere (guards, audit, outbox metadata). */
@Global()
@Module({
  providers: [{ provide: RequestContext, useValue: new RequestContext() }],
  exports: [RequestContext],
})
export class RequestContextModule {}
