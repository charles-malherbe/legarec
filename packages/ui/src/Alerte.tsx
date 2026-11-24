import type { ReactNode } from 'react';
import { Bouton } from './Bouton';
import { Icone } from './Icone';
import type { IconName } from './icons';
import css from './Alerte.module.css';
import tones from './tones.module.css';
import type { LayoutProps } from './types';

export interface AlerteProps extends LayoutProps {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  title?: string;
  text?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
  icon?: IconName;
  children?: ReactNode;
}
const ICON = { info: 'info', success: 'check-circle', warning: 'alert', danger: 'x-circle', neutral: 'info' } as const;

export function Alerte({ tone = 'warning', title, text, actionLabel, actionHref, onAction, onDismiss, compact, icon, children, layout }: AlerteProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`${tones.tone} ${css.root}`}
      data-tone={tone}
      data-compact={compact || undefined}
      style={layout}
    >
      <span className={css.icon}>
        <Icone icon={icon ?? ICON[tone]} size={18} />
      </span>
      <div className={css.body}>
        {title && <strong className={css.title}>{title}</strong>}
        {text && <span>{text}</span>}
        {children}
        {actionLabel && (
          <span className={css.action}>
            <Bouton label={actionLabel} variant="secondary" size="sm" href={actionHref} onPress={onAction} />
          </span>
        )}
      </div>
      {onDismiss && <Bouton label="Fermer" icon="x" iconOnly variant="ghost" size="xs" onPress={onDismiss} />}
    </div>
  );
}
