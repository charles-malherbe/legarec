import { useCallback, useEffect, useRef, useState } from 'react';

export const IDLE_WARNING_MS = 28 * 60_000;
export const IDLE_LOGOUT_MS = 30 * 60_000;
/** The API counts from what is asked of it: it is told of an activity that asks for nothing, at most once a minute. */
export const IDLE_TELL_MS = 60_000;

const SHARE_MS = 5_000;
const CHANNEL = 'legarec-activity';

/**
 * Warning at 28 minutes of inactivity, logout at 30. `onActive` tells the API that someone is still there. The tabs of the
 * same portal share one session, and tell each other: one that nobody looks at does not close the others.
 */
export function useIdle(onLogout: () => void, onActive?: () => void) {
  const [last, setLast] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const told = useRef(last);
  const shared = useRef(0);
  const share = useRef<() => void>(() => undefined);
  const warning = now - last >= IDLE_WARNING_MS;
  const expired = now - last >= IDLE_LOGOUT_MS;
  const tell = useCallback(() => {
    told.current = Date.now();
    onActive?.();
  }, [onActive]);
  const stay = useCallback(() => {
    setLast(Date.now());
    setNow(Date.now());
    share.current();
    tell();
  }, [tell]);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => {
      setLast(Date.now());
      setNow(Date.now());
    };
    share.current = () => channel.postMessage(null);
    return () => {
      share.current = () => undefined;
      channel.close();
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), warning ? 1000 : 15_000);
    return () => clearInterval(timer);
  }, [warning]);
  useEffect(() => {
    if (warning) return;
    const touch = () => {
      const at = Date.now();
      setLast(at);
      if (at - shared.current < SHARE_MS) return;
      shared.current = at;
      share.current();
    };
    document.addEventListener('mousedown', touch, true);
    document.addEventListener('keydown', touch, true);
    return () => {
      document.removeEventListener('mousedown', touch, true);
      document.removeEventListener('keydown', touch, true);
    };
  }, [warning]);
  // Never before the activity it tells of, so that the API does not close first.
  useEffect(() => {
    if (last > told.current && now - told.current >= IDLE_TELL_MS) tell();
  }, [last, now, tell]);
  useEffect(() => {
    if (expired) onLogout();
  }, [expired, onLogout]);
  return { warning: warning && !expired, secondsLeft: Math.max(0, Math.ceil((IDLE_LOGOUT_MS - (now - last)) / 1000)), stay };
}
