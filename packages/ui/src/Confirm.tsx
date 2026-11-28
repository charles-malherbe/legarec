import { FocusTrap, Portal } from '@mantine/core';
import { createContext, use, useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bouton } from './Bouton';
import { Case } from './Case';
import { Champ } from './Champ';
import css from './Confirm.module.css';
import { Icone } from './Icone';

export interface ConfirmDetail {
  k: string;
  v: string;
}
export interface ConfirmProps {
  open: boolean;
  tone?: 'primary' | 'danger';
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  details?: ConfirmDetail[];
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** What is said of the reason under its field: where it is kept. */
  reasonHelp?: string;
  /** Characters the reason needs, spaces around it left out, before the confirmation is allowed (1 by default). */
  reasonMinLength?: number;
  /** Exact text the user must type before confirming (irreversible actions). */
  typeToConfirm?: { label: string; expected: string };
  /** A box to tick in the dialog; `required` blocks the confirmation until it is ticked. */
  check?: { label: string; description?: string; required?: boolean };
  onConfirm: (reason: string, checked: boolean) => void | Promise<unknown>;
  onCancel: () => void;
}

export function Confirm({ open, ...props }: ConfirmProps) {
  return open ? <ConfirmBody {...props} /> : null;
}

function ConfirmBody({
  tone = 'primary',
  title,
  body,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  details = [],
  reasonLabel,
  reasonPlaceholder = 'Précisez le motif…',
  reasonHelp = "Obligatoire · conservé dans le journal d'audit",
  reasonMinLength = 1,
  typeToConfirm,
  check,
  onConfirm,
  onCancel,
}: Omit<ConfirmProps, 'open'>) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => void setTimeout(() => opener?.focus?.(), 0), [opener]);
  const textId = useId();
  const titleId = useId();
  const blocked = (!!reasonLabel && reason.trim().length < reasonMinLength) || (!!typeToConfirm && typed.trim() !== typeToConfirm.expected) || (!!check?.required && !checked);

  const confirm = async () => {
    if (blocked || pending) return;
    setPending(true);
    setFailed(false);
    try {
      await onConfirm(reason.trim(), checked);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!pending) onCancel();
      return;
    }
    const target = event.target as HTMLElement;
    if (event.key !== 'Enter' || (target.tagName === 'TEXTAREA' && !event.ctrlKey && !event.metaKey) || target.tagName === 'BUTTON') return;
    event.preventDefault();
    void confirm();
  };

  return (
    <Portal>
      <div
        className={css.overlay}
        data-modal-open="true"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !pending) onCancel();
        }}
      >
        <FocusTrap active>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={textId}
            aria-busy={pending}
            tabIndex={-1}
            className={css.dialog}
            onKeyDown={onKeyDown}
          >
            <div className={css.head}>
              <span className={css.icon} data-tone={tone}>
                <Icone icon={tone === 'danger' ? 'alert' : 'info'} size={20} />
              </span>
              <div className={css.text}>
                <h2 id={titleId} className={css.title}>
                  {title}
                </h2>
                <p id={textId} className={css.body}>
                  {body}
                </p>
              </div>
            </div>
            {details.length > 0 && (
              <dl className={css.details}>
                {details.map((detail) => (
                  <div key={detail.k} className={css.detail}>
                    <dt>{detail.k}</dt>
                    <dd>{detail.v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {reasonLabel && (
              <div className={css.field}>
                <Champ
                  type="textarea"
                  rows={3}
                  label={reasonLabel}
                  value={reason}
                  placeholder={reasonPlaceholder}
                  help={reasonHelp}
                  onChange={setReason}
                  autoFocus
                />
              </div>
            )}
            {typeToConfirm && (
              <div className={css.field}>
                <Champ label={typeToConfirm.label} value={typed} onChange={setTyped} autocomplete="off" spellCheck={false} autoFocus={!reasonLabel} />
              </div>
            )}
            {check && (
              <div className={css.field}>
                <Case checked={checked} label={check.label} description={check.description} onToggle={setChecked} />
              </div>
            )}
            {failed && (
              <p role="alert" className={css.failed}>
                L’action n’a pas abouti. Rien n’a été enregistré : réessayez.
              </p>
            )}
            <div className={css.foot}>
              <span className={css.hint}>Échap pour annuler</span>
              <Bouton variant="secondary" label={cancelLabel} onPress={onCancel} />
              <Bouton
                variant={tone === 'danger' ? 'danger' : 'primary'}
                label={pending ? 'Enregistrement en cours…' : confirmLabel}
                loading={pending}
                disabled={blocked}
                autoFocus={!reasonLabel && !typeToConfirm}
                onPress={() => void confirm()}
              />
            </div>
          </div>
        </FocusTrap>
      </div>
    </Portal>
  );
}

export type ConfirmRequest = Omit<ConfirmProps, 'open' | 'onCancel'>;
const ConfirmContext = createContext<((request: ConfirmRequest) => void) | null>(null);

/** Makes `useConfirm()` available everywhere; the dialog stays open if `onConfirm` rejects. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [open, setOpen] = useState(false);
  const ask = useCallback((next: ConfirmRequest) => {
    setRequest(next);
    setOpen(true);
  }, []);
  return (
    <ConfirmContext value={ask}>
      {children}
      {request && (
        <Confirm
          {...request}
          open={open}
          onCancel={() => setOpen(false)}
          onConfirm={async (reason, checked) => {
            await request.onConfirm(reason, checked);
            setOpen(false);
          }}
        />
      )}
    </ConfirmContext>
  );
}

export function useConfirm() {
  const ask = use(ConfirmContext);
  if (!ask) throw new Error('ConfirmProvider is missing');
  return ask;
}
