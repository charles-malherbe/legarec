import {
  backupCodes,
  linkInfo,
  loginResponse,
  partnerSession,
  proofNeeded,
  REQUEST_BODIES,
  session as staffSession,
  setupDone,
  totpKey,
  totpSetup,
  webauthnOptions,
} from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, type Type } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Anonymous, AnyStaff, Partner } from '../../platform/access/access';
import type { Actor } from '../../platform/database/actor';
import { Database } from '../../platform/database/database';
import { currentActor } from '../../platform/http/context';
import { NoTransaction } from '../../platform/http/transaction.interceptor';
import { Links } from './links';
import { Proofs } from './proofs';
import { Sessions, type AccountPortal } from './sessions';
import { SignIn } from './sign-in';
import { SessionViews } from './views';

/** The same routes for both portals, each with its own cookie, its own accounts and its own rules. */
export function authController(portal: AccountPortal): Type {
  const bodies = REQUEST_BODIES[portal];
  const SignedIn = portal === 'staff' ? AnyStaff : Partner;
  type Body_<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;

  @ApiTags('auth')
  @Controller(`${portal}/auth`)
  class AuthController {
    constructor(
      @Inject(SignIn) private readonly signIn: SignIn,
      @Inject(Links) private readonly links: Links,
      @Inject(Sessions) private readonly sessions: Sessions,
      @Inject(SessionViews) private readonly views: SessionViews,
    ) {}

    @Get('session')
    @SignedIn()
    @NoTransaction()
    @ApiOkResponse({ standardSchema: portal === 'staff' ? staffSession : partnerSession })
    session() {
      const actor = currentActor() as Extract<Actor, { kind: 'staff' | 'partner' }>;
      return actor.kind === 'staff' ? this.views.staff(actor) : this.views.partner(actor);
    }

    @Post('login')
    @Anonymous(portal)
    @NoTransaction()
    @HttpCode(200)
    @ApiOkResponse({ standardSchema: loginResponse })
    login(@Body({ schema: bodies['POST /auth/login'] }) body: Body_<'POST /auth/login'>) {
      return this.signIn.login(portal, body);
    }

    @Post('two-factor')
    @Anonymous(portal)
    @NoTransaction()
    @HttpCode(200)
    @ApiOkResponse({ standardSchema: loginResponse })
    secondFactor(@Body({ schema: bodies['POST /auth/two-factor'] }) body: Body_<'POST /auth/two-factor'>) {
      return this.signIn.secondFactor(portal, body);
    }

    @Post('two-factor/webauthn')
    @Anonymous(portal)
    @NoTransaction()
    @HttpCode(200)
    @ApiOkResponse({ standardSchema: webauthnOptions })
    keyOptions() {
      return this.signIn.keyOptions(portal);
    }

    @Post('setup/totp')
    @Anonymous(portal)
    @NoTransaction()
    @HttpCode(200)
    @ApiOkResponse({ standardSchema: totpSetup })
    startSetup() {
      return this.signIn.startSetup(portal);
    }

    @Post('setup/totp/verify')
    @Anonymous(portal)
    @NoTransaction()
    @HttpCode(200)
    @ApiOkResponse({ standardSchema: setupDone })
    finishSetup(@Body({ schema: bodies['POST /auth/setup/totp/verify'] }) { code }: Body_<'POST /auth/setup/totp/verify'>) {
      return this.signIn.finishSetup(portal, code);
    }

    @Post('logout')
    @Anonymous(portal)
    @NoTransaction()
    @HttpCode(204)
    @ApiNoContentResponse()
    logout() {
      return this.sessions.close(portal);
    }

    @Post('forgot-password')
    @Anonymous(portal)
    @NoTransaction()
    @HttpCode(204)
    @ApiNoContentResponse()
    forgot(@Body({ schema: bodies['POST /auth/forgot-password'] }) { email }: Body_<'POST /auth/forgot-password'>) {
      return this.signIn.forgot(email);
    }

    @Get('reset/:token')
    @Anonymous(portal)
    @NoTransaction()
    @ApiOkResponse({ standardSchema: linkInfo })
    resetInfo(@Param('token') token: string) {
      return this.links.info(portal, 'RESET', token);
    }

    @Post('reset/:token')
    @Anonymous(portal)
    @NoTransaction()
    @HttpCode(204)
    @ApiNoContentResponse()
    reset(@Param('token') token: string, @Body({ schema: bodies['POST /auth/reset/:token'] }) { password }: Body_<'POST /auth/reset/:token'>) {
      return this.links.reset(portal, token, password);
    }

    @Get('invitation/:token')
    @Anonymous(portal)
    @NoTransaction()
    @ApiOkResponse({ standardSchema: linkInfo })
    invitationInfo(@Param('token') token: string) {
      return this.links.info(portal, 'INVITATION', token);
    }

    @Post('invitation/:token/password')
    @Anonymous(portal)
    @NoTransaction()
    @HttpCode(200)
    @ApiOkResponse({ standardSchema: totpKey })
    choosePassword(
      @Param('token') token: string,
      @Body({ schema: bodies['POST /auth/invitation/:token/password'] }) { password }: Body_<'POST /auth/invitation/:token/password'>,
    ) {
      return this.links.choosePassword(portal, token, password);
    }

    @Post('invitation/:token/totp')
    @Anonymous(portal)
    @NoTransaction()
    @HttpCode(200)
    @ApiOkResponse({ standardSchema: backupCodes })
    verifyTotp(
      @Param('token') token: string,
      @Body({ schema: bodies['POST /auth/invitation/:token/totp'] }) { code }: Body_<'POST /auth/invitation/:token/totp'>,
    ) {
      return this.links.verifyTotp(portal, token, code);
    }
  }
  // Two classes of the same name would share their descriptions.
  Object.defineProperty(AuthController, 'name', { value: portal === 'staff' ? 'StaffAuthController' : 'PartnerAuthController' });
  return AuthController;
}

const proofBody = REQUEST_BODIES.staff['POST /auth/proof'];
/** Of the team only: nothing of the creditors needs it. */
@ApiTags('auth')
@Controller('staff/auth/proof')
export class ProofController {
  constructor(@Inject(Proofs) private readonly proofs: Proofs) {}

  @Get()
  @AnyStaff()
  @NoTransaction()
  @ApiOkResponse({ standardSchema: proofNeeded })
  needed() {
    return this.proofs.needed(currentActor() as Extract<Actor, { kind: 'staff' }>);
  }

  @Post('webauthn')
  @AnyStaff()
  @NoTransaction()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: webauthnOptions })
  keyOptions() {
    return this.proofs.keyOptions(currentActor() as Extract<Actor, { kind: 'staff' }>);
  }

  @Post()
  @AnyStaff()
  @NoTransaction()
  @HttpCode(204)
  @ApiNoContentResponse()
  give(@Body({ schema: proofBody }) body: z.infer<typeof proofBody>) {
    return this.proofs.give(currentActor() as Extract<Actor, { kind: 'staff' }>, body);
  }
}

const preferencesBody = REQUEST_BODIES.staff['PUT /auth/preferences'];
@ApiTags('auth')
@Controller('staff/auth/preferences')
export class PreferencesController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Put()
  @AnyStaff()
  @HttpCode(204)
  @ApiNoContentResponse()
  async save(@Body({ schema: preferencesBody }) body: z.infer<typeof preferencesBody>) {
    const { userId: id } = currentActor() as Extract<Actor, { kind: 'staff' }>;
    await this.database.tx.user.update({ where: { id }, data: body, select: { id: true } });
  }
}
