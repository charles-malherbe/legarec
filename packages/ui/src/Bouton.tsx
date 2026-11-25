import { UnstyledButton } from '@mantine/core';
import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router';
import { Icone } from './Icone';
import type { IconName } from './icons';
import css from './Bouton.module.css';
import type { LayoutProps } from './types';

export interface BoutonProps extends LayoutProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline' | 'success' | 'dark' | 'link';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  iconOnly?: boolean;
  kbd?: string;
  count?: string | number;
  href?: string;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  haspopup?: 'menu' | 'listbox' | 'dialog';
  controls?: string;
  title?: string;
  ariaLabel?: string;
  type?: 'button' | 'submit';
  autoFocus?: boolean;
  onPress?: (event: MouseEvent<HTMLElement>) => void;
}
const ICON_SIZE = { xs: 14, sm: 16, md: 16, lg: 18 } as const;

export function Bouton(props: BoutonProps) {
  const { label, variant = 'primary', size = 'md', icon, iconRight, kbd, count, href, disabled, loading, full, onPress, layout } = props;
  const iconOnly = !!props.iconOnly && !!icon;
  const title = props.title ?? (iconOnly ? label : kbd ? `${label.replace(/^\+\s*/, '')} (raccourci : ${kbd})` : undefined);
  const look = {
    className: css.root,
    style: layout,
    title,
    'aria-label': props.ariaLabel ?? (iconOnly ? label : undefined),
    'data-variant': variant,
    'data-size': size,
    'data-full': full || undefined,
    'data-icon-only': iconOnly || undefined,
    'data-ph-key': kbd?.toUpperCase(),
  };
  const content: ReactNode = (
    <>
      {loading && <span aria-hidden className={css.spinner} />}
      {icon && !loading && <Icone icon={icon} size={ICON_SIZE[size]} />}
      {!iconOnly && <span>{label}</span>}
      {count !== undefined && count !== '' && <span className={css.count}>{count}</span>}
      {kbd && <kbd className={css.kbd}>{kbd}</kbd>}
      {iconRight && <Icone icon={iconRight} size={ICON_SIZE[size]} />}
    </>
  );
  if (href && !disabled) {
    if (href.startsWith('/'))
      return (
        <Link to={href} onClick={onPress} {...look}>
          {content}
        </Link>
      );
    return (
      <a href={href} onClick={onPress} {...look}>
        {content}
      </a>
    );
  }
  return (
    <UnstyledButton
      {...look}
      type={props.type ?? 'button'}
      disabled={disabled}
      data-autofocus={props.autoFocus || undefined}
      aria-busy={loading || undefined}
      aria-pressed={props.pressed}
      aria-expanded={props.expanded}
      aria-haspopup={props.haspopup}
      aria-controls={props.controls}
      onClick={(event: MouseEvent<HTMLElement>) => {
        if (!loading) onPress?.(event);
        else event.preventDefault();
      }}
    >
      {content}
    </UnstyledButton>
  );
}
