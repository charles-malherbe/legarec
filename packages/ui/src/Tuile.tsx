import { UnstyledButton } from '@mantine/core';
import { Link } from 'react-router';
import { Badge } from './Badge';
import { Icone } from './Icone';
import type { IconName } from './icons';
import { Statut } from './Statut';
import css from './Tuile.module.css';
import type { LayoutProps, Tone } from './types';

export interface TuileProps extends LayoutProps {
  title: string;
  description?: string;
  icon?: IconName;
  status?: string;
  statusTone?: Tone;
  badge?: string;
  badgeTone?: Tone;
  href?: string;
  onPress?: () => void;
}

export function Tuile({
  title,
  description,
  icon = 'settings',
  status,
  statusTone = 'success',
  badge,
  badgeTone = 'neutral',
  href,
  onPress,
  layout,
}: TuileProps) {
  const content = (
    <>
      <span className={css.icon}>
        <Icone icon={icon} size={20} />
      </span>
      <span className={css.text}>
        <span className={css.heading}>
          <span className={css.title}>{title}</span>
          {badge && <Badge label={badge} tone={badgeTone} />}
        </span>
        {description && <span className={css.description}>{description}</span>}
        {status && (
          <span className={css.status}>
            <Statut label={status} tone={statusTone} wrap />
          </span>
        )}
      </span>
      <span className={css.chevron}>
        <Icone icon="chevron-right" size={18} />
      </span>
    </>
  );
  return href ? (
    <Link to={href} className={css.root} style={layout}>
      {content}
    </Link>
  ) : (
    <UnstyledButton className={css.root} style={layout} onClick={onPress}>
      {content}
    </UnstyledButton>
  );
}
