import { cssVariablesResolver, espaceTheme } from '@legarec/tokens';
import { ActivationPage, ConfirmProvider, ForgotPasswordPage, PageLegale, Reauthentification, ResetPasswordPage, ToastProvider } from '@legarec/ui';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import { BillingPage } from '../features/billing/BillingPage';
import { RemittancesPage } from '../features/billing/RemittancesPage';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { TeamPage } from '../features/team/TeamPage';
import { AccountPage } from '../features/account/AccountPage';
import { ArticlePage } from '../features/help/ArticlePage';
import { HelpPage } from '../features/help/HelpPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { MergeFieldsPage } from '../features/templates/MergeFieldsPage';
import { TemplatePage } from '../features/templates/TemplatePage';
import { CallsPage } from '../features/calls/CallsPage';
import { ComposePage } from '../features/documents/ComposePage';
import { DocumentsPage } from '../features/documents/DocumentsPage';
import { EmailsPage } from '../features/emails/EmailsPage';
import { SmsPage } from '../features/sms/SmsPage';
import { CaseFormPage } from '../features/cases/CaseFormPage';
import { CasePage } from '../features/cases/CasePage';
import { CasesPage } from '../features/cases/CasesPage';
import { CreditorFormPage } from '../features/creditors/CreditorFormPage';
import { CreditorPage } from '../features/creditors/CreditorPage';
import { CreditorsPage } from '../features/creditors/CreditorsPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { ErrorPage } from '../features/error/ErrorPage';
import { LitigationPage } from '../features/litigation/LitigationPage';
import { LoginPage } from '../features/login/LoginPage';
import { PlansPage } from '../features/plans/PlansPage';
import { CreditorScopeProvider } from './creditorScope';
import { opens } from './features';
import { CurrentUser, SESSION_KEY, useSession, useSessionEnd } from './session';
import { Shell } from './Shell';

// FullCalendar is only loaded with the agenda.
const RemindersPage = lazy(() => import('../features/reminders/RemindersPage').then((module) => ({ default: module.RemindersPage })));

const ReportsPage = lazy(() => import('../features/reports/ReportsPage').then((module) => ({ default: module.ReportsPage })));

// Demonstration of the library, left out of production builds.
const LibraryPage = import.meta.env.DEV ? lazy(() => import('../features/library/LibraryPage').then((module) => ({ default: module.LibraryPage }))) : null;

function RequireSession() {
  const { data, isPending } = useSession();
  const client = useQueryClient();
  useSessionEnd();
  if (isPending) return null;
  // A single answer that fails changes nothing: what is on screen stays.
  if (data === undefined) return <ErrorPage code={500} />;
  return data ? (
    // Another person, another screen: nothing typed, asked nor about to be confirmed by the former one is left.
    <CurrentUser key={data.userId} value={data}>
      <ToastProvider>
        <ConfirmProvider>
          <CreditorScopeProvider>
            <Reauthentification onClosed={() => void client.invalidateQueries({ queryKey: SESSION_KEY })}>
              <Outlet />
            </Reauthentification>
          </CreditorScopeProvider>
        </ConfirmProvider>
      </ToastProvider>
    </CurrentUser>
  ) : (
    <Navigate to="/connexion" replace />
  );
}

export function App() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <MantineProvider theme={espaceTheme} cssVariablesResolver={cssVariablesResolver}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
          <Route path="/reinitialisation/:token" element={<ResetPasswordPage />} />
          <Route path="/activation/:token" element={<ActivationPage />} />
          <Route path="/mentions-legales" element={<PageLegale page="mentions" />} />
          <Route path="/confidentialite" element={<PageLegale page="confidentialite" />} />
          <Route path="/cookies" element={<PageLegale page="cookies" />} />
          <Route path="/erreur-demo" element={<ErrorPage code={404} />} />
          {/* A section of the settings left out of this build: its address is unknown, like the screens left out below. */}
          {!opens('/parametres/techniques/boites') && <Route path="/parametres/techniques/boites" element={<ErrorPage code={404} />} />}
          <Route element={<RequireSession />}>
            <Route element={<Shell />}>
              <Route index element={<DashboardPage />} />
              <Route path="creanciers" element={<CreditorsPage />} />
              <Route path="creanciers/nouveau" element={<CreditorFormPage key="new" />} />
              <Route path="creanciers/:id" element={<CreditorPage />} />
              <Route path="creanciers/:id/modifier" element={<CreditorFormPage />} />
              <Route path="debiteurs" element={<CasesPage />} />
              <Route path="debiteurs/nouveau" element={<CaseFormPage />} />
              <Route path="debiteurs/:id" element={<CasePage />} />
              <Route
                path="relances"
                element={
                  <Suspense fallback={null}>
                    <RemindersPage />
                  </Suspense>
                }
              />
              <Route path="echeanciers" element={<PlansPage />} />
              {/* Left out of a build without their API (decision 194): « Page introuvable », never a screen in error. */}
              {opens('/appels') && <Route path="appels" element={<CallsPage />} />}
              {opens('/e-mails') && <Route path="e-mails" element={<EmailsPage />} />}
              {opens('/sms') && <Route path="sms" element={<SmsPage />} />}
              <Route path="notifications" element={<NotificationsPage />} />
              <Route
                path="rapports"
                element={
                  <Suspense fallback={null}>
                    <ReportsPage />
                  </Suspense>
                }
              />
              <Route path="equipe" element={<TeamPage />} />
              <Route path="facturation" element={<BillingPage />} />
              <Route path="facturation/reversements" element={<RemittancesPage />} />
              <Route path="documents" element={<DocumentsPage />} />
              {opens('/documents/rediger') && <Route path="documents/rediger" element={<ComposePage />} />}
              <Route path="contentieux" element={<LitigationPage />} />
              <Route path="parametres" element={<SettingsPage />} />
              <Route path="parametres/champs-de-fusion" element={<MergeFieldsPage />} />
              <Route path="parametres/modeles/:id" element={<TemplatePage />} />
              <Route path="parametres/techniques" element={<SettingsPage key="techniques" scope="techniques" />} />
              <Route path="parametres/techniques/:section" element={<SettingsPage key="techniques" scope="techniques" />} />
              <Route path="parametres/:section" element={<SettingsPage />} />
              {LibraryPage && (
                <Route
                  path="bibliotheque"
                  element={
                    <Suspense fallback={null}>
                      <LibraryPage />
                    </Suspense>
                  }
                />
              )}
              <Route path="compte" element={<AccountPage />} />
              <Route path="aide" element={<HelpPage />} />
              <Route path="aide/:slug" element={<ArticlePage />} />
            </Route>
          </Route>
          <Route path="*" element={<ErrorPage code={404} />} />
        </Routes>
      </QueryClientProvider>
    </MantineProvider>
  );
}
