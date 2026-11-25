import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlers, resetPortal, setPartner } from '../mocks/handlers';
import { App } from './App';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => resetPortal());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const openAs = (account: string, path = '/') => {
  setPartner(account);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
};

describe('a session that ends by itself', () => {
  it('never shows a creditor what another one was shown', async () => {
    openAs('cb', '/dossiers');
    expect((await screen.findAllByText('Bâtiplus SAS'))[0]).toBeVisible();
    setPartner('none');
    await userEvent.click(screen.getByRole('link', { name: 'Reversements' }));
    await userEvent.type(await screen.findByLabelText('Adresse e-mail'), 'p.roche@energiesrhone.example');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
    // Nothing comes: what was there before must not fill the gap.
    server.use(http.get('/api/portal/*', () => new Promise<never>(() => undefined)));
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect((await screen.findAllByText('Énergies Rhône'))[0]).toBeVisible();
    await userEvent.click(screen.getByRole('link', { name: 'Mes dossiers' }));
    expect(document.body.textContent).not.toMatch(/Bâtiplus|Matériaux Delta/u);
  });

  it('is that of whoever signed in from another tab', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      openAs('cb', '/dossiers');
      expect((await screen.findAllByText('Bâtiplus SAS'))[0]).toBeVisible();
      setPartner('pr');
      await vi.advanceTimersByTimeAsync(61_000);
      act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })));
      await vi.advanceTimersByTimeAsync(80_000);
      await waitFor(() => expect(document.body.textContent).not.toMatch(/Bâtiplus|Matériaux Delta/u));
      expect((await screen.findAllByText('Fromagerie Durand'))[0]).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });
});

it('leaves nothing on the screen with « Se déconnecter »', async () => {
  openAs('cb', '/dossiers');
  expect((await screen.findAllByText('Bâtiplus SAS'))[0]).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
  expect(await screen.findByRole('button', { name: 'Se connecter' })).toBeVisible();
  expect(document.body.textContent).not.toMatch(/Bâtiplus|Matériaux Delta|Claire Besson/u);
});

it('leaves the screen as it is when a beat fails', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  try {
    openAs('cb', '/dossiers');
    expect((await screen.findAllByText('Bâtiplus SAS'))[0]).toBeVisible();
    let beats = 0;
    server.use(
      http.get('/api/auth/session', () => {
        beats += 1;
        return HttpResponse.json({ code: 'UNAVAILABLE' }, { status: 502 });
      }),
    );
    await vi.advanceTimersByTimeAsync(61_000);
    await user.keyboard('a');
    await vi.advanceTimersByTimeAsync(80_000);
    await waitFor(() => expect(beats).toBeGreaterThan(0));
    expect(screen.getAllByText('Bâtiplus SAS')[0]).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});
