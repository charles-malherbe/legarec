import { useCallback, useEffect, useState } from 'react';

export const IDLE_WARNING_MS = 28 * 60_000;
export const IDLE_LOGOUT_MS = 30 * 60_000;

/** Warning at 28 minutes of inactivity, logout at 30. */
export function useIdle(onLogout: () => void) {
  const [last, setLast] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const warning = now - last >= IDLE_WARNING_MS;
  const expired = now - last >= IDLE_LOGOUT_MS;
  const stay = useCallback(() => {
    setLast(Date.now());
    setNow(Date.now());
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), warning ? 1000 : 15_000);
    return () => clearInterval(timer);
  }, [warning]);
  useEffect(() => {
    if (warning) return;
    const touch = () => setLast(Date.now());
    document.addEventListener('mousedown', touch, true);
    document.addEventListener('keydown', touch, true);
    return () => {
      document.removeEventListener('mousedown', touch, true);
      document.removeEventListener('keydown', touch, true);
    };
  }, [warning]);
  useEffect(() => {
    if (expired) onLogout();
  }, [expired, onLogout]);
  return { warning: warning && !expired, secondsLeft: Math.max(0, Math.ceil((IDLE_LOGOUT_MS - (now - last)) / 1000)), stay };
}
