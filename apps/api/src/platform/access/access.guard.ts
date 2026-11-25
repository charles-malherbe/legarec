import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Actor } from '../database/actor';
import { forbidden, unauthorized } from '../errors/api-error';
import { ACCESS, ACTOR_RESOLVER, allow, type AccessRule, type ActorResolver } from './access';

export interface AppRequest extends Request {
  requestId: string;
  actor: Actor;
}

/** Refuses by default: no rule, no answer. */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ACTOR_RESOLVER) private readonly resolver: ActorResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS, [context.getHandler(), context.getClass()]);
    if (!access) throw forbidden();
    const request = context.switchToHttp().getRequest<AppRequest>();
    const open = access.portal === 'public' || access.portal === 'hook' || access.portal === 'health' || ('anonymous' in access && access.anonymous);
    const actor = allow(access, open ? null : await this.resolver.resolve(access.portal, request as never));
    if (actor === null) throw unauthorized();
    if (actor === false) throw forbidden();
    request.actor = actor;
    return true;
  }
}
