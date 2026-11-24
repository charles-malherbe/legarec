import { useEffect, useRef } from 'react';

/** Shortcuts are inactive while typing, with a modifier, or while a dialog is open. */
export function isShortcutBlocked(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return true;
  const target = event.target as HTMLElement | null;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return true;
  return !!document.querySelector('[data-modal-open="true"]');
}

export function useShortcut(handler: (event: KeyboardEvent) => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!isShortcutBlocked(event)) latest.current(event);
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
}
