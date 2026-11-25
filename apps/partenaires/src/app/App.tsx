import { cssVariablesResolver, publicTheme } from '@legarec/tokens';
import {
  ActivationPage,
  ConfirmProvider,
  EtatListe,
  ForgotPasswordPage,
  FormulaireConnexion,
  PageLegale,
  PortailContext,
  ResetPasswordPage,
  ToastProvider,
} from '@legarec/ui';
import { signedIn } from '@legarec/platform';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router';
import { CasesPage } from '../features/CasesPage';
import { DashboardPage } from '../features/DashboardPage';
import { DepositPage } from '../features/DepositPage';
import { DocumentsPage } from '../features/DocumentsPage';
import { HelpPage } from '../features/HelpPage';
import { MessagesPage } from '../features/MessagesPage';
import { PayoutsPage } from '../features/PayoutsPage';
import { CurrentPartner, SESSION_KEY, useSession, useSessionEnd } from './data';
import { Shell } from './Shell';

function RequireSession() {
  const { data, isPending, refetch } = useSession();
  useSessionEnd();
  if (isPending) return null;
  // A single answer that fails changes nothing: what is on screen stays.
  if (data === undefined) return <EtatListe kind="error" onAction={() => void refetch()} />;
  return data ? (
    // Another person, another screen: nothing typed, asked nor about to be confirmed by the former one is left.
    <CurrentPartner key={data.userId} value={data}>
      <ToastProvider>
        <ConfirmProvider>
          <Outlet />
        </ConfirmProvider>
      </ToastProvider>
    </CurrentPartner>
  ) : (
    <Navigate to="/connexion" replace />
  );
}
function LoginPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const open = async () => {
    // Whoever was there before.
    client.clear();
    signedIn();
    await client.resetQueries({ queryKey: SESSION_KEY });
    await navigate('/');
  };
  return <FormulaireConnexion onSession={() => void open()} />;
}

export function App() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <MantineProvider theme={publicTheme} cssVariablesResolver={cssVariablesResolver}>
      <QueryClientProvider client={client}>
        <PortailContext value="partenaires">
          <Routes>
            <Route path="/connexion" element={<LoginPage />} />
            <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
            <Route path="/reinitialisation/:token" element={<ResetPasswordPage />} />
            <Route path="/activation/:token" element={<ActivationPage />} />
            <Route path="/aide" element={<HelpPage />} />
            <Route path="/mentions-legales" element={<PageLegale page="mentions" />} />
            <Route path="/confidentialite" element={<PageLegale page="confidentialite" />} />
            <Route path="/cookies" element={<PageLegale page="cookies" />} />
            <Route element={<RequireSession />}>
              <Route element={<Shell />}>
                <Route index element={<DashboardPage />} />
                <Route path="dossiers" element={<CasesPage />} />
                <Route path="depot" element={<DepositPage />} />
                <Route path="reversements" element={<PayoutsPage />} />
                <Route path="messages" element={<MessagesPage />} />
                <Route path="releves" element={<DocumentsPage />} />
                <Route path="*" element={<EtatListe kind="empty" title="Page introuvable" text="Cette page n’existe pas ou a été déplacée." />} />
              </Route>
            </Route>
          </Routes>
        </PortailContext>
      </QueryClientProvider>
    </MantineProvider>
  );
}
