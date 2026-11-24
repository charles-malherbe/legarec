import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icone } from './Icone';
import css from './Toast.module.css';

type ToastTone = 'success' | 'danger' | 'info';
export interface ToastProps {
  open: boolean;
  message: string;
  tone?: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
  inline?: boolean;
}
const ICON = { success: 'check-circle', danger: 'alert', info: 'info' } as const;

export function Toast({ open, message, tone = 'success', actionLabel, onAction, onClose, inline }: ToastProps) {
  if (!open) return null;
  return (
    <div className={css.wrap} data-inline={inline || undefined}>
      <div role={tone === 'danger' ? 'alert' : 'status'} className={css.root} data-tone={tone}>
        <span className={css.icon}>
          <Icone icon={ICON[tone]} size={18} />
        </span>
        <span className={css.message}>{message}</span>
        {actionLabel && (
          <button type="button" className={css.action} onClick={onAction}>
            {actionLabel}
          </button>
        )}
        <button type="button" className={css.close} aria-label="Fermer la notification" onClick={onClose}>
          <Icone icon="x" size={16} />
        </button>
      </div>
    </div>
  );
}

export interface ToastRequest {
  message: string;
  tone?: ToastTone;
  undo?: () => void;
}
const ToastContext = createContext<((request: ToastRequest) => void) | null>(null);

export function ToastProvider({ children, duration = 8000 }: { children: ReactNode; duration?: number }) {
  const [current, setCurrent] = useState<ToastRequest | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback(
    (request: ToastRequest) => {
      clearTimeout(timer.current);
      setCurrent(request);
      timer.current = setTimeout(() => setCurrent(null), duration);
    },
    [duration],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = () => setCurrent(null);
  return (
    <ToastContext value={useMemo(() => show, [show])}>
      {children}
      <Toast
        open={!!current}
        message={current?.message ?? ''}
        tone={current?.tone}
        actionLabel={current?.undo ? 'Annuler' : undefined}
        onAction={() => {
          current?.undo?.();
          close();
        }}
        onClose={close}
      />
    </ToastContext>
  );
}

export function useToast() {
  const show = use(ToastContext);
  if (!show) throw new Error('ToastProvider is missing');
  return show;
}
