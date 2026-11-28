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
import { CasesController } from './cases/cases.controller';
import { CasesService } from './cases/cases.service';
import { ContactsService } from './cases/contacts.service';
import { CreditorsController } from './creditors/creditors.controller';
import { CreditorsService } from './creditors/creditors.service';
import { AccessCodes } from './debtor-access/access-codes';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { TemplatesController } from './templates/templates.controller';
import { TemplatesService } from './templates/templates.service';
import { DebtorSignIn } from './auth/debtor-sign-in';
import { DebtorController, StaffPortalController } from './debtor-access/debtor.controller';
import { LimitedSpace } from './debtor-access/limited';
import { PortalMessages } from './debtor-access/portal-messages';
import { DebtorViews } from './debtor-access/debtor-views';
import { PortalController } from './partners/portal.controller';
import { ClaimImports } from './partners/imports';
import { PortalService } from './partners/portal.service';
import { DelegationsController } from './delegations/delegations.controller';
import { MembersController } from './members/members.controller';
import { TeamController } from './members/team.controller';
import { MembersService } from './members/members.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { GdprController } from './gdpr/gdpr.controller';
import { BillingController } from './remittances/billing.controller';
import { CreditNotesController } from './remittances/credit-notes.controller';
import { RemittancesController } from './remittances/remittances.controller';
import { HooksController } from './reminders/hooks.controller';
import { RemindersController } from './reminders/reminders.controller';
import { ResendEventsService } from './reminders/resend-events.service';
import { RemindersService } from './reminders/reminders.service';
import { SendingsService } from './reminders/sendings.service';
import { Clock } from '../platform/clock';
import { AiController } from '../ai/ai.controller';
import { AiJournalController } from '../ai/journal.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { DepositsController } from './deposits/deposits.controller';
import { DepositsService } from './deposits/deposits.service';
import { LitigationController } from './litigation/litigation.controller';
import { LitigationService } from './litigation/litigation.service';
import { Ledgers } from './payments/ledger';
import { InterestRatesController, PaymentsController, PlansController } from './payments/payments.controller';
import { Plans } from './payments/plans';
import { SettingsController } from './settings/settings.controller';
import { ShellController } from './shell/shell.controller';
import { SupportController } from './support/support.controller';
import { SecretsController } from './vault/secrets.controller';
import { InternalKeys } from './vault/internal-keys';
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
  AiController,
  AiJournalController,
  RemindersController,
  HooksController,
  LitigationController,
  DepositsController,
  RemittancesController,
  CreditNotesController,
  BillingController,
  GdprController,
  DashboardController,
  ReportsController,
  TeamController,
  SecretsController,
  SettingsController,
  CreditorsController,
  CasesController,
  PaymentsController,
  PlansController,
  InterestRatesController,
  DocumentsController,
  TemplatesController,
  DebtorController,
  StaffPortalController,
  PortalController,
  ShellController,
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
  InternalKeys,
  AccessCodes,
  CreditorsService,
  CasesService,
  ContactsService,
  NotificationsService,
  RemindersService,
  SendingsService,
  ResendEventsService,
  Clock,
  LitigationService,
  DepositsService,
  DashboardService,
  ReportsService,
  Ledgers,
  Plans,
  DocumentsService,
  TemplatesService,
  DebtorSignIn,
  DebtorViews,
  PortalMessages,
  LimitedSpace,
  PortalService,
  ClaimImports,
];
