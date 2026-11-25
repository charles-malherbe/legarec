import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CONFIG, type Config } from '../config/config';
import type { Actor } from '../database/actor';
import { forbidden, unauthorized } from '../errors/api-error';
import { setCurrentActor } from '../http/context';
import { acceptsOrigin } from '../http/origin';
import { ACCESS, ACTOR_RESOLVER, allow, isOpen, type AccessRule, type ActorResolver } from './access';

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
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS, [context.getHandler(), context.getClass()]);
    if (!access) throw forbidden();
    const request = context.switchToHttp().getRequest<AppRequest>();
    // From the rule of the route, however its path was written.
    if (!acceptsOrigin(access.portal, request.method, request.headers.origin, this.config)) throw forbidden();
    const actor = allow(access, isOpen(access) ? null : await this.resolver.resolve(access.portal, request as never));
    if (actor === null) throw unauthorized();
    if (actor === false) throw forbidden();
    request.actor = actor;
    setCurrentActor(actor);
    return true;
  }
}
