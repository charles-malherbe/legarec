import type { ReactNode } from 'react';
import { Badge } from './Badge';
import { Bouton } from './Bouton';
import css from './Carte.module.css';
import type { IconName } from './icons';
import type { LayoutProps, Tone } from './types';

export interface CarteProps extends LayoutProps {
  title?: string;
  description?: string;
  badge?: string;
  badgeTone?: Tone;
  actionLabel?: string;
  actionIcon?: IconName;
  actionHref?: string;
  onAction?: () => void;
  padding?: 'none' | 'sm' | 'md';
  tone?: 'default' | 'subtle' | 'highlight' | 'danger';
  footer?: ReactNode;
  children?: ReactNode;
}

export function Carte({
  title,
  description,
  badge,
  badgeTone = 'neutral',
  actionLabel,
  actionIcon,
  actionHref,
  onAction,
  padding = 'md',
  tone = 'default',
  footer,
  children,
  layout,
}: CarteProps) {
  return (
    <section aria-label={title} className={css.root} data-tone={tone} style={layout}>
      {title && (
        <div className={css.head} data-open={children ? true : undefined}>
          <div className={css.text}>
            <div className={css.heading}>
              <h2 className={css.title}>{title}</h2>
              {badge && <Badge label={badge} tone={badgeTone} />}
            </div>
            {description && <p className={css.description}>{description}</p>}
          </div>
          {actionLabel && <Bouton label={actionLabel} variant="secondary" size="sm" icon={actionIcon} href={actionHref} onPress={onAction} />}
        </div>
      )}
      <div className={css.body} data-padding={padding}>
        {children}
      </div>
      {footer && <div className={css.foot}>{footer}</div>}
    </section>
  );
}
