import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { finalize, type Observable } from 'rxjs';
import type { AppRequest } from '../access/access.guard';
import { LOGGER, type AppLogger } from './logger';

/** One line per answered request: the model of the route, never its path, its query nor its body. */
@Injectable()
export class AccessLogInterceptor implements NestInterceptor {
  constructor(@Inject(LOGGER) private readonly logger: AppLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<AppRequest>();
    const response = http.getResponse<Response>();
    const started = performance.now();
    return next.handle().pipe(
      finalize(() => {
        response.once('finish', () => {
          this.logger.info(
            {
              requestId: request.requestId,
              method: request.method,
              route: (request.route as { path?: string } | undefined)?.path,
              status: response.statusCode,
              ms: Math.round(performance.now() - started),
              actor: request.actor?.kind,
            },
            'request',
          );
        });
      }),
    );
  }
}
