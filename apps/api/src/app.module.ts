import { Module, StandardSchemaValidationPipe, type DynamicModule, type OnApplicationBootstrap, type OnApplicationShutdown, type Type } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE, DiscoveryModule, ModuleRef } from '@nestjs/core';
import { HealthController } from './health/health.controller';
import { ACTOR_RESOLVER, NobodyResolver, type ActorResolver } from './platform/access/access';
import { AccessGuard } from './platform/access/access.guard';
import { checkRoutes, routesOf } from './platform/access/routes';
import { Audit } from './platform/audit/audit';
import { CONFIG, type Config } from './platform/config/config';
import { Database } from './platform/database/database';
import { invalid } from './platform/errors/api-error';
import { ApiErrorFilter } from './platform/errors/api-error.filter';
import { TransactionInterceptor } from './platform/http/transaction.interceptor';
import { AccessLogInterceptor } from './platform/logging/access-log';
import { LOGGER, type AppLogger } from './platform/logging/logger';
import { Outbox } from './platform/queue/outbox';
import { VALKEY, type Valkey } from './platform/queue/valkey';

export interface AppParts {
  config: Config;
  logger: AppLogger;
  database: Database;
  valkey: Valkey;
  /** Replaced by the sessions as soon as the accounts exist. */
  resolver?: ActorResolver;
  controllers?: Type[];
}

@Module({})
export class AppModule implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
    @Inject(Database) private readonly database: Database,
    @Inject(VALKEY) private readonly valkey: Valkey,
  ) {}

  static with(parts: AppParts): DynamicModule {
    return {
      module: AppModule,
      imports: [DiscoveryModule],
      controllers: [HealthController, ...(parts.controllers ?? [])],
      providers: [
        { provide: CONFIG, useValue: parts.config },
        { provide: LOGGER, useValue: parts.logger },
        { provide: Database, useValue: parts.database },
        { provide: VALKEY, useValue: parts.valkey },
        { provide: ACTOR_RESOLVER, useValue: parts.resolver ?? new NobodyResolver() },
        Audit,
        Outbox,
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        { provide: APP_GUARD, useClass: AccessGuard },
        // Outermost first: the line of the log is written once the transaction is over.
        { provide: APP_INTERCEPTOR, useClass: AccessLogInterceptor },
        { provide: APP_INTERCEPTOR, useClass: TransactionInterceptor },
        {
          provide: APP_PIPE,
          useValue: new StandardSchemaValidationPipe({
            // Only the place of each error: a message could quote what was typed.
            exceptionFactory: (issues) =>
              invalid({ fields: issues.map((issue) => (issue.path ?? []).map((part) => String(typeof part === 'object' ? part.key : part)).join('.')) }),
          }),
        },
      ],
    };
  }

  onApplicationBootstrap(): void {
    checkRoutes(routesOf(this.moduleRef as never));
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.database.close(), this.valkey.quit().catch(() => undefined)]);
  }
}
