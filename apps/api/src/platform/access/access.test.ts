import { All, Controller, Get, Post, Put, Scope, type ExecutionContext, type Type } from '@nestjs/common';
import { DiscoveryModule, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../database/actor';
import {
  ACCESS,
  allow,
  Anonymous,
  AnyStaff,
  Debtor,
  Health,
  Hook,
  NobodyResolver,
  Partner,
  Public,
  ServiceAccount,
  Staff,
  StaffOrDelegate,
  type AccessRule,
} from './access';
import { AccessGuard } from './access.guard';
import { checkRoutes, routesOf } from './routes';

type StaffActor = Extract<Actor, { kind: 'staff' }>;
const staff = (role: StaffActor['role'], delegations: StaffActor['delegations'] = []): StaffActor => ({ kind: 'staff', userId: 'u', role, delegations });
const ACTORS: Record<string, Actor> = {
  director: staff('DIRECTOR'),
  manager: staff('COLLECTION_MANAGER', ['ADMINISTRATIVE']),
  managerAlone: staff('COLLECTION_MANAGER'),
  developer: staff('DEVELOPER', ['TECHNICAL']),
  officer: staff('CLAIMS_OFFICER'),
  partner: { kind: 'partner', userId: 'p', creditorId: 'c' },
  debtor: { kind: 'debtor', debtorId: 'd' },
  service: { kind: 'service', accountId: 's' },
  // Never found by a session: none of them may pass for a signed-in person.
  anonymous: { kind: 'anonymous' },
  public: { kind: 'public' },
  hook: { kind: 'hook' },
  worker: { kind: 'worker', job: 'x' },
  retention: { kind: 'retention' },
};
const allowed = (rule: AccessRule) =>
  Object.entries(ACTORS)
    .filter(([, actor]) => allow(rule, actor))
    .map(([name]) => name);

describe('rules', () => {
  it.each<[string, AccessRule, string[]]>([
    ['any collaborator', { portal: 'staff' }, ['director', 'manager', 'managerAlone', 'developer', 'officer']],
    ['the Director', { portal: 'staff', roles: ['DIRECTOR'] }, ['director']],
    ['the team of the cases', { portal: 'staff', roles: ['COLLECTION_MANAGER', 'CLAIMS_OFFICER'] }, ['manager', 'managerAlone', 'officer']],
    ['the Director or the administrative delegate', { portal: 'staff', roles: ['DIRECTOR'], delegation: 'ADMINISTRATIVE' }, ['director', 'manager']],
    ['the Director or the technical delegate', { portal: 'staff', roles: ['DIRECTOR'], delegation: 'TECHNICAL' }, ['director', 'developer']],
    // A list of roles left empty opens to nobody, not to everybody.
    ['no role at all', { portal: 'staff', roles: [] }, []],
    ['a delegate alone', { portal: 'staff', roles: [], delegation: 'TECHNICAL' }, ['developer']],
    ['a creditor', { portal: 'partner' }, ['partner']],
    ['a debtor', { portal: 'debtor' }, ['debtor']],
    ['a service account', { portal: 'service', scope: 'calls' }, ['service']],
  ])('open to %s and to nobody else', (_who, rule, expected) => {
    expect(allowed(rule)).toEqual(expected);
    expect(allow(rule, null)).toBeNull();
  });

  it.each<[AccessRule, Actor['kind']]>([
    [{ portal: 'staff', anonymous: true }, 'anonymous'],
    [{ portal: 'partner', anonymous: true }, 'anonymous'],
    [{ portal: 'debtor', anonymous: true }, 'anonymous'],
    [{ portal: 'public' }, 'public'],
    [{ portal: 'health' }, 'public'],
    [{ portal: 'hook' }, 'hook'],
  ])('give the rights of %j to everyone, a signed-in person included', (rule, kind) => {
    for (const actor of [null, ...Object.values(ACTORS)]) expect(allow(rule, actor)).toEqual({ kind });
  });

  it('mark an action done for the Director, and only that one', () => {
    const rule: AccessRule = { portal: 'staff', roles: ['DIRECTOR'], delegation: 'ADMINISTRATIVE' };
    expect(allow(rule, ACTORS.manager!)).toEqual({ ...ACTORS.manager, actingFor: 'ADMINISTRATIVE' });
    expect(allow(rule, ACTORS.director!)).toEqual(ACTORS.director);
    // The right comes from the role here: nothing is done for someone else.
    expect(allow({ portal: 'staff', roles: ['COLLECTION_MANAGER'], delegation: 'ADMINISTRATIVE' }, ACTORS.manager!)).toEqual(ACTORS.manager);
    expect(allow({ portal: 'staff' }, ACTORS.manager!)).toEqual(ACTORS.manager);
    // The actor of the session itself is left as it was for the next request.
    expect(ACTORS.manager).not.toHaveProperty('actingFor');
  });

  it('are written by the decorators as they are named', () => {
    class Named {
      @Staff('DIRECTOR') director() {}
      @StaffOrDelegate('TECHNICAL', 'DIRECTOR') delegate() {}
      @AnyStaff() any() {}
      @Partner() partner() {}
      @Debtor() debtor() {}
      @Anonymous('partner') anonymous() {}
      @Public() public() {}
      @Hook() hook() {}
      @ServiceAccount('calls') service() {}
      @Health() health() {}
    }
    const reflector = new Reflector();
    const written = Object.getOwnPropertyNames(Named.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => [name, reflector.get<AccessRule>(ACCESS, (Named.prototype as unknown as Record<string, () => void>)[name]!)]);
    expect(Object.fromEntries(written)).toEqual({
      director: { portal: 'staff', roles: ['DIRECTOR'] },
      delegate: { portal: 'staff', roles: ['DIRECTOR'], delegation: 'TECHNICAL' },
      any: { portal: 'staff' },
      partner: { portal: 'partner' },
      debtor: { portal: 'debtor' },
      anonymous: { portal: 'partner', anonymous: true },
      public: { portal: 'public' },
      hook: { portal: 'hook' },
      service: { portal: 'service', scope: 'calls' },
      health: { portal: 'health' },
    });
  });

  // Defect: the scope is written on the route and read by nothing; any service account opens any service route.
  it.fails('keep a service account to its scope', () => {
    const account = { kind: 'service', accountId: 's', scopes: ['calls'] } as unknown as Actor;
    expect(allow({ portal: 'service', scope: 'calls' }, account)).toBeTruthy();
    expect(allow({ portal: 'service', scope: 'secrets' }, account)).toBe(false);
  });
});

describe('guard', () => {
  class Routes {
    @AnyStaff() staff() {}
    @Partner() partner() {}
    @Anonymous('staff') anonymous() {}
    @Public() public() {}
    @Hook() hook() {}
    @Health() health() {}
    open() {}
  }
  const request = (handler: () => void, type: Type = Routes) => {
    const http = { headers: {} } as Record<string, unknown>;
    return {
      http,
      context: { getHandler: () => handler, getClass: () => type, switchToHttp: () => ({ getRequest: () => http }) } as unknown as ExecutionContext,
    };
  };
  const { prototype } = Routes;
  const guard = (actor: Actor | null) => {
    const resolve = vi.fn(() => Promise.resolve(actor));
    return { resolve, guard: new AccessGuard(new Reflector(), { resolve }) };
  };

  it('refuses a route without any rule, even to the Director, without looking who calls', async () => {
    const { guard: target, resolve } = guard(ACTORS.director!);
    const { context, http } = request(prototype.open);
    await expect(target.canActivate(context)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(resolve).not.toHaveBeenCalled();
    expect(http.actor).toBeUndefined();
  });

  it('asks who calls for the portal of the route, and keeps the answer for the transaction', async () => {
    const { guard: target, resolve } = guard(ACTORS.partner!);
    const { context, http } = request(prototype.partner);
    expect(await target.canActivate(context)).toBe(true);
    expect(resolve).toHaveBeenCalledExactlyOnceWith('partner', http);
    expect(http.actor).toEqual(ACTORS.partner);
  });

  it('answers 401 to a stranger and 403 to the wrong person, and names no actor', async () => {
    const stranger = request(prototype.staff);
    await expect(guard(null).guard.canActivate(stranger.context)).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    const wrong = request(prototype.staff);
    await expect(guard(ACTORS.partner!).guard.canActivate(wrong.context)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect([stranger.http.actor, wrong.http.actor]).toEqual([undefined, undefined]);
  });

  it.each(['anonymous', 'public', 'hook', 'health'] as const)('never reads a session on a route open to all (%s)', async (name) => {
    const { guard: target, resolve } = guard(ACTORS.director!);
    const { context, http } = request(prototype[name]);
    expect(await target.canActivate(context)).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect((http.actor as Actor).kind).toBe(name === 'health' ? 'public' : name);
  });

  it('lets nobody in until the sessions exist', async () => {
    const target = new AccessGuard(new Reflector(), new NobodyResolver());
    await expect(target.canActivate(request(prototype.staff).context)).rejects.toMatchObject({ status: 401 });
  });
});

describe('routes', () => {
  const routes = async (...controllers: Type[]) => {
    const module = await Test.createTestingModule({ imports: [DiscoveryModule], controllers }).compile();
    const found = routesOf(module);
    await module.close();
    return found;
  };
  const ids = async (...controllers: Type[]) => (await routes(...controllers)).map((route) => route.id).sort();
  const refused = async (...controllers: Type[]) => {
    const found = await routes(...controllers);
    try {
      checkRoutes(found);
      return [];
    } catch (error) {
      return (error as Error).message.replace(/^[^:]*: /u, '').split(', ');
    }
  };

  it('are found one by one: lists of paths, every method, inherited and request-scoped handlers', async () => {
    @Controller(['staff/many', 'staff/several'])
    class Many {
      @Get(['a', 'b/c'])
      @AnyStaff()
      list() {}
      @All('any')
      @AnyStaff()
      any() {}
    }
    class Base {
      @Put('inherited')
      @AnyStaff()
      inherited() {}
    }
    @Controller('staff/child')
    class Child extends Base {
      helper() {}
    }
    @Controller({ path: 'staff/scoped', scope: Scope.REQUEST })
    class Scoped {
      @Post(':id/action')
      @AnyStaff()
      act() {}
    }
    expect(await ids(Many, Child, Scoped)).toEqual([
      'ALL /staff/many/any',
      'ALL /staff/several/any',
      'GET /staff/many/a',
      'GET /staff/many/b/c',
      'GET /staff/several/a',
      'GET /staff/several/b/c',
      'POST /staff/scoped/:id/action',
      'PUT /staff/child/inherited',
    ]);
    expect(await refused(Many, Child, Scoped)).toEqual([]);
  });

  it('need a rule each, wherever they come from', async () => {
    @Controller('staff/mixed')
    class Mixed {
      @Get('ruled')
      @AnyStaff()
      ruled() {}
      @Get(['one', 'two'])
      forgotten() {}
      @All('any')
      any() {}
    }
    class Base {
      @Get('inherited')
      inherited() {}
    }
    @Controller('staff/child')
    class Child extends Base {}
    @Controller({ path: 'staff/scoped', scope: Scope.REQUEST })
    class Scoped {
      @Get()
      open() {}
    }
    expect((await refused(Mixed, Child, Scoped)).sort()).toEqual([
      'ALL /staff/mixed/any',
      'GET /staff/child/inherited',
      'GET /staff/mixed/one',
      'GET /staff/mixed/two',
      'GET /staff/scoped',
    ]);
  });

  it('follow the rule of their class, unless they have their own', async () => {
    @Controller('staff/ruled')
    @AnyStaff()
    class Ruled {
      @Get()
      inside() {}
      @Get('narrow')
      @Staff('DIRECTOR')
      narrow() {}
    }
    expect((await routes(Ruled)).map(({ id, access }) => [id, access])).toEqual([
      ['GET /staff/ruled', { portal: 'staff' }],
      ['GET /staff/ruled/narrow', { portal: 'staff', roles: ['DIRECTOR'] }],
    ]);
    expect(await refused(Ruled)).toEqual([]);
  });

  it('cannot leave the prefix of their portal, by any of their paths', async () => {
    @Controller(['staff/both', 'partner/both'])
    class Both {
      @Get()
      @AnyStaff()
      read() {}
    }
    @Controller(':portal/any')
    class Anywhere {
      @Get()
      @AnyStaff()
      read() {}
    }
    @Controller()
    class Root {
      @Get('staffroom')
      @AnyStaff()
      lookAlike() {}
      @Get('Staff/upper')
      @AnyStaff()
      upper() {}
      @Get('staff/public')
      @Public()
      open() {}
      @Get('public')
      @Public()
      fine() {}
      @Get('staff/health')
      @Health()
      health() {}
    }
    expect((await refused(Both, Anywhere, Root)).sort()).toEqual([
      'GET /:portal/any',
      'GET /Staff/upper',
      'GET /partner/both',
      'GET /staff/health',
      'GET /staff/public',
      'GET /staffroom',
    ]);
  });

  it.each<[AccessRule, string]>([
    [{ portal: 'staff' }, '/staff'],
    [{ portal: 'partner' }, '/partner'],
    [{ portal: 'debtor' }, '/debtor'],
    [{ portal: 'public' }, '/public'],
    [{ portal: 'hook' }, '/hooks'],
    [{ portal: 'service', scope: 'x' }, '/service'],
    [{ portal: 'health' }, '/health'],
  ])('keep %j under %s', (access, prefix) => {
    expect(() =>
      checkRoutes([
        { id: `GET ${prefix}`, access },
        { id: `GET ${prefix}/x`, access },
      ]),
    ).not.toThrow();
    for (const other of ['/staff', '/partner', '/debtor', '/public', '/hooks', '/service', '/health', '/'].filter((path) => path !== prefix))
      expect(() => checkRoutes([{ id: `GET ${other}/x`, access }]), other).toThrow(`GET ${other}/x`);
    expect(() => checkRoutes([{ id: `GET ${prefix}x`, access }])).toThrow(`GET ${prefix}x`);
    expect(() => checkRoutes([{ id: `GET ${prefix}/x`, access: undefined }])).toThrow(`GET ${prefix}/x`);
  });
});
