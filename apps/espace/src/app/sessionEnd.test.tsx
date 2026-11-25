import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ACCOUNTS } from '../mocks/accounts';
import { setAccount } from '../mocks/state';
import { mockApi, openAs } from '../testing';
import { CurrentUser, SESSION_KEY, useCurrentUser } from './session';

const server = mockApi();
const signInForm = () => screen.findByRole('button', { name: 'Se connecter' });
const signIn = async (email: string) => {
  await userEvent.type(await screen.findByLabelText('Adresse e-mail'), email);
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
};

describe('a session that ends by itself', () => {
  it('goes back to the sign-in with the first refusal, and keeps nothing for the next person', async () => {
    openAs('ad', '/debiteurs');
    expect(await screen.findByText(/LGR-2026-00142/)).toBeVisible();
    // Closed by the API: too long without anything, or by the support.
    setAccount('none');
    await userEvent.click(screen.getByRole('link', { name: 'Échéanciers' }));
    await signInForm();
    // Someone else, on the same tab: the list of the former one is never shown, even while theirs is loading.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(http.post('/api/cases/search', async () => void (await gate)));
    await signIn('hb@legarec.fr');
    await screen.findByRole('heading', { name: 'Bonjour Hugo' });
    await userEvent.click(screen.getByRole('link', { name: 'Débiteurs' }));
    expect(screen.queryByText(/LGR-2026-00142/)).toBeNull();
    release();
    expect(await screen.findByText(/LGR-2026-00151/)).toBeVisible();
    expect(screen.queryByText(/LGR-2026-00142/)).toBeNull();
  });

  it('is that of whoever signed in from another tab', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      openAs('ad', '/debiteurs');
      expect(await screen.findByText(/LGR-2026-00142/)).toBeVisible();
      setAccount('hb');
      await vi.advanceTimersByTimeAsync(61_000);
      act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })));
      await vi.advanceTimersByTimeAsync(80_000);
      await waitFor(() => expect(screen.queryByText(/LGR-2026-00142/)).toBeNull());
      expect(await screen.findByText(/LGR-2026-00151/)).toBeVisible();
      expect(screen.getByRole('button', { name: /Compte de Hugo Benali/ })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });
});

it('never breaks a screen between two sessions: whoever it was opened for stays until it is closed', () => {
  // As when the answer of the session comes with another one: the cache already knows nobody, the screen is still there.
  const client = new QueryClient();
  client.setQueryData(SESSION_KEY, null);
  const Name = () => <p>{useCurrentUser().firstName}</p>;
  render(
    <QueryClientProvider client={client}>
      <CurrentUser value={ACCOUNTS[0]!}>
        <Name />
      </CurrentUser>
    </QueryClientProvider>,
  );
  expect(screen.getByText('Camille')).toBeVisible();
});

describe('a beat that fails', () => {
  it('leaves the screen as it is', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
      openAs('cl', '/aide');
      const field = await screen.findByRole('textbox', { name: 'Message' });
      await user.type(field, 'Une longue question');
      let beats = 0;
      server.use(
        http.get('/api/auth/session', () => {
          beats += 1;
          return HttpResponse.json({ code: 'UNAVAILABLE' }, { status: 502 });
        }),
      );
      await vi.advanceTimersByTimeAsync(61_000);
      await user.type(field, ' au support');
      await vi.advanceTimersByTimeAsync(80_000);
      await waitFor(() => expect(beats).toBeGreaterThan(0));
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Une longue question au support');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is asked again when there was no answer at all', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      server.use(http.get('/api/auth/session', () => HttpResponse.json({ code: 'UNAVAILABLE' }, { status: 502 })));
      openAs('cl', '/');
      await vi.advanceTimersByTimeAsync(3_000);
      expect(screen.queryByRole('heading', { name: 'Bonjour Camille' })).toBeNull();
      server.resetHandlers();
      await vi.advanceTimersByTimeAsync(12_000);
      expect(await screen.findByRole('heading', { name: 'Bonjour Camille' })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('what the former person had begun', () => {
  it('is never confirmed by the next one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
      openAs('ad', '/compte');
      await user.click(await screen.findByRole('tab', { name: /Sécurité/ }));
      await user.click((await screen.findAllByRole('button', { name: /^Déconnecter : / }))[0]!);
      expect(screen.getByRole('alertdialog')).toBeVisible();
      await act(async () => void (await vi.advanceTimersByTimeAsync(31 * 60_000)));
      await signInForm();
      expect(screen.queryByRole('alertdialog')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not stay typed for whoever signed in from another tab', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
      openAs('ad', '/aide');
      await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Confidentiel');
      // Nothing was told: found by the beat.
      setAccount('hb');
      await vi.advanceTimersByTimeAsync(61_000);
      act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })));
      await vi.advanceTimersByTimeAsync(80_000);
      expect(await screen.findByRole('button', { name: /Compte de Hugo Benali/ })).toBeVisible();
      expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('another tab', () => {
  it('empties the screen at once, before the API has answered', async () => {
    openAs('ad', '/debiteurs');
    expect(await screen.findByText(/LGR-2026-00142/)).toBeVisible();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(http.get('/api/auth/session', async () => void (await gate)));
    const other = new BroadcastChannel('legarec-session');
    try {
      other.postMessage(null);
      await waitFor(() => expect(screen.queryByText(/LGR-2026-00142/)).toBeNull());
      expect(screen.queryByRole('button', { name: /^Compte de/ })).toBeNull();
      setAccount('none');
      release();
      await signInForm();
    } finally {
      other.close();
    }
  });

  it('is told of a sign-out, of a sign-in and of a session found closed', async () => {
    const told = vi.fn();
    const other = new BroadcastChannel('legarec-session');
    other.onmessage = told;
    try {
      openAs('ad', '/debiteurs');
      expect(await screen.findByText(/LGR-2026-00142/)).toBeVisible();
      expect(told).not.toHaveBeenCalled();
      setAccount('none');
      await userEvent.click(screen.getByRole('link', { name: 'Échéanciers' }));
      await signInForm();
      await waitFor(() => expect(told).toHaveBeenCalled());
      told.mockClear();
      await signIn('hb@legarec.fr');
      await screen.findByRole('heading', { name: 'Bonjour Hugo' });
      await waitFor(() => expect(told).toHaveBeenCalled());
      told.mockClear();
      await userEvent.click(screen.getByRole('button', { name: /Compte de Hugo Benali/ }));
      await userEvent.click(await screen.findByText('Se déconnecter'));
      await signInForm();
      await waitFor(() => expect(told).toHaveBeenCalled());
    } finally {
      other.close();
    }
  });
});

describe('a sign-out that the API does not receive', () => {
  it('is not asked of the next person', async () => {
    openAs('ad', '/');
    let asked = 0;
    server.use(
      http.post('/api/auth/logout', () => {
        asked += 1;
        return HttpResponse.json({ code: 'UNAVAILABLE' }, { status: 503 });
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: /^Compte de/ }));
    await userEvent.click(await screen.findByText('Se déconnecter'));
    await signInForm();
    await signIn('hb@legarec.fr');
    expect(await screen.findByRole('heading', { name: 'Bonjour Hugo' })).toBeVisible();
    cleanup();
    openAs('hb', '/');
    expect(await screen.findByRole('heading', { name: 'Bonjour Hugo' })).toBeVisible();
    expect(asked).toBe(1);
  });

  it('is asked again before anyone is shown', async () => {
    openAs('ad', '/');
    let asked = 0;
    server.use(
      http.post('/api/auth/logout', () => {
        asked += 1;
        return HttpResponse.json({ code: 'UNAVAILABLE' }, { status: 503 });
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: /^Compte de/ }));
    await userEvent.click(await screen.findByText('Se déconnecter'));
    await signInForm();
    expect(asked).toBe(1);
    // Loaded again: the cookie still opens the account, and nobody is shown.
    cleanup();
    openAs('ad', '/');
    await signInForm();
    expect(asked).toBe(2);
    cleanup();
    server.resetHandlers();
    openAs('ad', '/');
    await signInForm();
    await signIn('hb@legarec.fr');
    expect(await screen.findByRole('heading', { name: 'Bonjour Hugo' })).toBeVisible();
    cleanup();
    openAs('hb', '/');
    expect(await screen.findByRole('heading', { name: 'Bonjour Hugo' })).toBeVisible();
  });
});
