import { Catch, HttpException, Inject, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { LOGGER, type AppLogger } from '../logging/logger';
import { ApiError } from './api-error';

const BY_STATUS: Record<number, string> = {
  400: 'INVALID_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'NOT_FOUND',
  413: 'TOO_LARGE',
  415: 'UNSUPPORTED_TYPE',
  422: 'INVALID',
  429: 'TOO_MANY',
};

/** Code of PostgreSQL when it refused (42501, 23505…), otherwise the code of Prisma. */
export function databaseCode(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const meta = error.meta as { driverAdapterError?: { cause?: { originalCode?: string } } } | undefined;
  return meta?.driverAdapterError?.cause?.originalCode ?? error.code;
}

function toApiError(error: unknown): ApiError | null {
  if (error instanceof ApiError) return error;
  // Above 500, it is a defect: logged and answered like any other.
  if (error instanceof HttpException)
    return error.getStatus() < 500 ? new ApiError(error.getStatus(), BY_STATUS[error.getStatus()] ?? 'INVALID_REQUEST') : null;
  // Thrown by the body parser of Express, before any controller.
  const status = (error as { status?: unknown; type?: unknown } | null)?.type !== undefined ? (error as { status?: unknown }).status : undefined;
  if (typeof status === 'number' && status >= 400 && status < 500) return new ApiError(status, BY_STATUS[status] ?? 'INVALID_REQUEST');
  switch (databaseCode(error)) {
    case 'P2002':
    case '23505':
      return new ApiError(409, 'CONFLICT');
    // An identifier that is not one designates nothing.
    case 'P2025':
    case 'P2023':
    case 'P2007':
    case '22P02':
      return new ApiError(404, 'NOT_FOUND');
    // A character PostgreSQL cannot hold.
    case '22021':
    case '22P05':
      return new ApiError(422, 'INVALID');
    default:
      return null;
  }
}

/** Every error leaves as `{ code }`. The message, the query and the stack stay in the log, under the request number. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: AppLogger) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { requestId?: string }>();
    if (response.headersSent) {
      response.end();
      return;
    }
    const known = toApiError(error);
    if (known) {
      response.status(known.status).json({ code: known.code, ...known.details });
      return;
    }
    const code = databaseCode(error);
    // A refusal of PostgreSQL behind the guards is a defect of the API, or an attempt: never a detail for the caller.
    this.logger.error(
      { requestId: request.requestId, errorType: (error as Error)?.name, databaseCode: code, stack: safeStack(error) },
      code === '42501' ? 'refused by PostgreSQL' : 'unexpected error',
    );
    response.status(code === '42501' ? 403 : 500).json(code === '42501' ? { code: 'FORBIDDEN' } : { code: 'INTERNAL', requestId: request.requestId });
  }
}

/** Stack without its first line: a message may quote a value. */
function safeStack(error: unknown): string | undefined {
  return error instanceof Error
    ? error.stack
        ?.split('\n')
        .filter((line) => /^\s+at /u.test(line))
        .slice(0, 12)
        .join('\n')
    : undefined;
}
