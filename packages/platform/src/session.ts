import { z } from 'zod';
import { api } from './http';

/**
 * The tabs of a portal share one cookie. What one of them does to the session, sign-in or sign-out, is told to the others,
 * which show nothing more of the former one. Nobody is named: they ask the API who is there now.
 */
const CHANNEL = 'legarec-session';
/** A sign-out that the API did not receive: the cookie, out of reach here, still opens the account. Holds no token. */
const UNFINISHED = 'legarec-signing-out';

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

export function onSessionChanged(listener: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  listeners.add(listener);
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => {
      for (const tell of listeners) tell();
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    channel?.close();
    channel = null;
  };
}

/** Never to this tab itself. */
export function tellSessionChanged(): void {
  if (channel) return channel.postMessage(null);
  if (typeof BroadcastChannel === 'undefined') return;
  const once = new BroadcastChannel(CHANNEL);
  once.postMessage(null);
  once.close();
}

const unfinished = {
  get: () => {
    try {
      return localStorage.getItem(UNFINISHED) !== null;
    } catch {
      return false;
    }
  },
  set: (value: boolean) => {
    try {
      if (value) localStorage.setItem(UNFINISHED, '1');
      else localStorage.removeItem(UNFINISHED);
    } catch {
      // Without storage, the session closes by itself after 30 minutes.
    }
  },
};

/** Closes the session. Whatever the API answers, the screen is emptied; unreachable, it is asked again before anything else. */
export async function signOut(): Promise<void> {
  unfinished.set(true);
  try {
    await api(z.undefined(), '/auth/logout', { method: 'POST' });
    unfinished.set(false);
  } catch {
    // Asked again by the next call to finishSignOut().
  }
  tellSessionChanged();
}

/** To be called before asking who is there: false while a former session may still be open, which shows nobody. */
export async function finishSignOut(): Promise<boolean> {
  if (!unfinished.get()) return true;
  try {
    await api(z.undefined(), '/auth/logout', { method: 'POST' });
  } catch {
    return false;
  }
  unfinished.set(false);
  return true;
}

/** Someone has just signed in: another cookie, so that nothing is left to close. */
export function signedIn(): void {
  unfinished.set(false);
  tellSessionChanged();
}
