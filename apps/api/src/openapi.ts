import 'reflect-metadata';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import type { AccessRule } from './platform/access/access';
import { routesOf } from './platform/access/routes';

/** Description of every route, written from the same Zod schemas as the portals. */
export function describeApi(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Legarec').setVersion('1').build());
  // Who may call each route, so that a change of rule shows in the review.
  for (const { id, access } of routesOf(app)) {
    const [method = '', path = ''] = id.split(' ');
    const operation = document.paths[path.replace(/:(\w+)/gu, '{$1}')]?.[method.toLowerCase() as 'get'];
    if (operation && access) (operation as unknown as Record<string, unknown>)['x-access'] = access satisfies AccessRule;
  }
  return document;
}
