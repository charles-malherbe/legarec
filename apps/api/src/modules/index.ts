import type { Provider, Type } from '@nestjs/common';
import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { Accounts } from './auth/accounts';
import { authController, PreferencesController } from './auth/auth.controller';
import { AuthKeys } from './auth/keys';
import { Links } from './auth/links';
import { SecondFactors } from './auth/second-factors';
import { SessionResolver, Sessions } from './auth/sessions';
import { SignIn } from './auth/sign-in';
import { SessionViews } from './auth/views';
import { DelegationsController } from './delegations/delegations.controller';
import { MembersController } from './members/members.controller';
import { MembersService } from './members/members.service';
import { NotificationsController } from './notifications/notifications.controller';
import { SettingsController } from './settings/settings.controller';
import { SupportController } from './support/support.controller';
import { SecretsController } from './vault/secrets.controller';
import { Vault } from './vault/vault';

/** Routes of the portals, by domain. */
export const controllers: Type[] = [
  authController('staff'),
  authController('partner'),
  PreferencesController,
  AccountController,
  MembersController,
  DelegationsController,
  SupportController,
  NotificationsController,
  SecretsController,
  SettingsController,
];
export const providers: Provider[] = [
  AuthKeys,
  Accounts,
  Sessions,
  SessionResolver,
  SecondFactors,
  SessionViews,
  SignIn,
  Links,
  AccountService,
  MembersService,
  Vault,
];
