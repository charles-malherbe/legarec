import { cssVariablesResolver, publicTheme } from '@legarec/tokens';
import { ConfirmProvider, EtatListe, PageLegale, ToastProvider } from '@legarec/ui';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import { AccessPage } from '../features/AccessPage';
import { HomePage } from '../features/HomePage';
import { LimitedPage } from '../features/LimitedPage';
import { MessagesPage } from '../features/MessagesPage';
import { PayPage } from '../features/PayPage';
import { PlanPage } from '../features/PlanPage';
import { RequestsPage } from '../features/RequestsPage';
import { useSession } from './data';
import { Frame } from './Frame';
import { Space } from './Space';

function RequireSession() {
  const { data, isPending, isError, refetch } = useSession();
  if (isPending) return null;
  if (isError)
    return (
      <Frame>
        <EtatListe kind="error" onAction={() => void refetch()} />
      </Frame>
    );
  return data ? <Outlet /> : <Navigate to="/" replace />;
}

export function App() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <MantineProvider theme={publicTheme} cssVariablesResolver={cssVariablesResolver}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ConfirmProvider>
            <Routes>
              <Route path="/mentions-legales" element={<PageLegale page="mentions" />} />
              <Route path="/confidentialite" element={<PageLegale page="confidentialite" />} />
              <Route path="/cookies" element={<PageLegale page="cookies" />} />
              <Route path="/acces-limite" element={<LimitedPage />} />
              <Route path="/espace" element={<RequireSession />}>
                <Route element={<Space />}>
                  <Route index element={<HomePage />} />
                  <Route path="messages" element={<MessagesPage />} />
                  <Route path="demandes" element={<RequestsPage />} />
                  <Route path="payer" element={<PayPage />} />
                  <Route path="echeancier" element={<PlanPage />} />
                </Route>
              </Route>
              <Route path="/" element={<AccessPage />} />
              <Route path="/:token" element={<AccessPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MantineProvider>
  );
}
