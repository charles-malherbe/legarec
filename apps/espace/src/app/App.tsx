import { cssVariablesResolver, espaceTheme } from '@legarec/tokens';
import { ConfirmProvider, ToastProvider } from '@legarec/ui';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import { BillingPage } from '../features/billing/BillingPage';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { TeamPage } from '../features/team/TeamPage';
import { CallsPage } from '../features/calls/CallsPage';
import { ComposePage } from '../features/documents/ComposePage';
import { DocumentsPage } from '../features/documents/DocumentsPage';
import { EmailsPage } from '../features/emails/EmailsPage';
import { SmsPage } from '../features/sms/SmsPage';
import { CasePage } from '../features/cases/CasePage';
import { CasesPage } from '../features/cases/CasesPage';
import { CreditorPage } from '../features/creditors/CreditorPage';
import { CreditorsPage } from '../features/creditors/CreditorsPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { ErrorPage } from '../features/error/ErrorPage';
import { LitigationPage } from '../features/litigation/LitigationPage';
import { LoginPage } from '../features/login/LoginPage';
import { ActivationPage, ForgotPasswordPage, ResetPasswordPage } from '../features/login/PasswordPages';
import { PlansPage } from '../features/plans/PlansPage';
import { CreditorScopeProvider } from './creditorScope';
import { useSession } from './session';
import { Shell } from './Shell';

// FullCalendar is only loaded with the agenda.
const RemindersPage = lazy(() => import('../features/reminders/RemindersPage').then((module) => ({ default: module.RemindersPage })));

const ReportsPage = lazy(() => import('../features/reports/ReportsPage').then((module) => ({ default: module.ReportsPage })));

function RequireSession() {
  const { data, isPending, isError } = useSession();
  if (isPending) return null;
  if (isError) return <ErrorPage code={500} />;
  return data ? <Outlet /> : <Navigate to="/connexion" replace />;
}

export function App() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <MantineProvider theme={espaceTheme} cssVariablesResolver={cssVariablesResolver}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ConfirmProvider>
            <CreditorScopeProvider>
              <Routes>
                <Route path="/connexion" element={<LoginPage />} />
                <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
                <Route path="/reinitialisation/:token" element={<ResetPasswordPage />} />
                <Route path="/activation/:token" element={<ActivationPage />} />
                <Route path="/erreur-demo" element={<ErrorPage code={404} />} />
                <Route element={<RequireSession />}>
                  <Route element={<Shell />}>
                    <Route index element={<DashboardPage />} />
                    <Route path="creanciers" element={<CreditorsPage />} />
                    <Route path="creanciers/:id" element={<CreditorPage />} />
                    <Route path="debiteurs" element={<CasesPage />} />
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
                    <Route path="appels" element={<CallsPage />} />
                    <Route path="e-mails" element={<EmailsPage />} />
                    <Route path="sms" element={<SmsPage />} />
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
                    <Route path="documents" element={<DocumentsPage />} />
                    <Route path="documents/rediger" element={<ComposePage />} />
                    <Route path="contentieux" element={<LitigationPage />} />
                  </Route>
                </Route>
                <Route path="*" element={<ErrorPage code={404} />} />
              </Routes>
            </CreditorScopeProvider>
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MantineProvider>
  );
}
