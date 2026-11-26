import type { ReactNode } from 'react';
import { Bouton } from './Bouton';
import { Icone } from './Icone';
import css from './SuggestionIA.module.css';
import type { LayoutProps } from './types';

export interface SuggestionIAProps extends LayoutProps {
  title: string;
  status?: 'proposed' | 'applied' | 'ignored';
  facts?: { k: string; v: string }[];
  applyLabel?: string;
  appliedText?: string;
  ignoredText?: string;
  note?: string;
  headerExtra?: ReactNode;
  /** A line under the title (when it was written, from what); `headerExtra` stays on the line of the title. */
  subtitle?: string;
  onApply?: () => void;
  onIgnore?: () => void;
  onUndo?: () => void;
  children?: ReactNode;
}

/** Never applies anything by itself: every change goes through a click. */
export function SuggestionIA({
  title,
  status = 'proposed',
  facts = [],
  applyLabel = 'Appliquer',
  appliedText = 'Suggestion appliquée.',
  ignoredText = 'Suggestion ignorée.',
  note = 'Proposé par l’IA, à vérifier',
  headerExtra,
  subtitle,
  onApply,
  onIgnore,
  onUndo,
  children,
  layout,
}: SuggestionIAProps) {
  return (
    <section aria-label={title} className={css.root} style={layout}>
      <div className={css.head}>
        <span className={css.icon}>
          <Icone icon="sparkle" size={16} />
        </span>
        <strong className={css.title}>{title}</strong>
        {headerExtra}
      </div>
      {subtitle && <p className={css.subtitle}>{subtitle}</p>}
      {status === 'ignored' ? (
        <p className={css.muted}>{ignoredText}</p>
      ) : (
        <>
          {children}
          {facts.length > 0 && (
            <dl className={css.facts}>
              {facts.map((fact) => (
                <div key={fact.k} className={css.fact}>
                  <dt>{fact.k}</dt>
                  <dd>{fact.v}</dd>
                </div>
              ))}
            </dl>
          )}
          {status === 'proposed' && (onApply || onIgnore) && (
            <div className={css.actions}>
              {onApply && <Bouton size="sm" label={applyLabel} onPress={onApply} />}
              {onIgnore && <Bouton size="sm" variant="ghost" label="Ignorer" onPress={onIgnore} />}
            </div>
          )}
          {status === 'applied' && (
            <div role="status" className={css.applied}>
              <span>{appliedText}</span>
              {onUndo && <Bouton size="sm" variant="ghost" label="Annuler" onPress={onUndo} />}
            </div>
          )}
        </>
      )}
      <span className={css.note}>{note}</span>
    </section>
  );
}
