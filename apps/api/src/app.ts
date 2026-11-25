import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, type AppParts } from './app.module';
import { jsonOnly, originOf, requestNumber, securityHeaders } from './platform/http/security';
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
  app.use(requestNumber, securityHeaders, originOf(parts.config), jsonOnly());
  app.useBodyParser('json', { limit: '1mb', type: 'application/json' });
  app.enableShutdownHooks();
  return app;
}
