import '@mantine/core/styles.layer.css';
import '@legarec/tokens/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';

async function start() {
  // Simulated data in development only; production builds call the API.
  if (import.meta.env.DEV) {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledFrame: 'bypass', quiet: true });
  }
  const container = document.getElementById('root');
  if (container)
    createRoot(container).render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    );
}

void start();
