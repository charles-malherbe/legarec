import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, type AppParts } from './app.module';
import { openRequest } from './platform/http/context';
import { jsonOnly, portalsOnly, securityHeaders } from './platform/http/security';
import { accessLog } from './platform/logging/access-log';
import { FILE_MAX_BYTES } from './platform/storage/storage';

/** Routes whose body is a file. */
export const UPLOADS = [/^\/staff\/documents\/import$/u, /^\/debtor\/attachments$/u];
import { NestLogger } from './platform/logging/logger';

/** The HTTP API, ready to listen. The same one is tested, documented and served. */
export async function createApp(parts: AppParts): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.with(parts), {
    bodyParser: false,
    logger: new NestLogger(parts.logger),
    abortOnError: false,
  });
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('query parser', 'simple');
  // The address of the caller is the one set by Caddy, and by nobody else.
  app.set('trust proxy', parts.config.TRUSTED_PROXIES);
  app.use(accessLog(parts.logger), openRequest, securityHeaders, portalsOnly(parts.config), jsonOnly(UPLOADS));
  app.useBodyParser('json', { limit: '1mb', type: 'application/json' });
  // A file is the whole body, up to 15 Mo, on the routes that expect one.
  app.useBodyParser('raw', { limit: FILE_MAX_BYTES, type: (request) => UPLOADS.some((pattern) => pattern.test((request as { path?: string }).path ?? '')) });
  app.enableShutdownHooks();
  return app;
}
