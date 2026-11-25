import type { Provider, Type } from '@nestjs/common';
import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { Accounts } from './auth/accounts';
import { authController, PreferencesController, ProofController } from './auth/auth.controller';
import { AuthKeys } from './auth/keys';
import { Links } from './auth/links';
import { Proofs } from './auth/proofs';
import { SecondFactors } from './auth/second-factors';
import { SessionResolver, Sessions } from './auth/sessions';
import { SignIn } from './auth/sign-in';
import { SessionViews } from './auth/views';
import { CreditorsController } from './creditors/creditors.controller';
import { CreditorsService } from './creditors/creditors.service';
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
  ProofController,
  AccountController,
  MembersController,
  DelegationsController,
  SupportController,
  NotificationsController,
  SecretsController,
  SettingsController,
  CreditorsController,
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
  Proofs,
  AccountService,
  MembersService,
  Vault,
  CreditorsService,
];
