import { UnstyledButton } from '@mantine/core';
import { useId, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Icone } from './Icone';
import type { IconName } from './icons';
import { useToastIfAny } from './Toast';
import css from './Bouton.module.css';
import type { LayoutProps } from './types';

/** What a « Bientôt » button says, on hover, to a screen reader and when it is pressed. */
export const soonText = (soon: true | string) => `Bientôt disponible${soon === true ? '.' : ` : ${soon}`}`;

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
  /**
   * A part not finished yet (DECISIONS.md, 28/11/2026): greyed with « Bientôt », still reachable from the keyboard. A link
   * still leads to its page; a button says « Bientôt disponible » instead of acting. The text says what the part waits for.
   */
  soon?: boolean | string;
}
const ICON_SIZE = { xs: 14, sm: 16, md: 16, lg: 18 } as const;

export function Bouton(props: BoutonProps) {
  const { label, variant = 'primary', size = 'md', icon, iconRight, kbd, count, href, loading, full, onPress, layout } = props;
  const iconOnly = !!props.iconOnly && !!icon;
  const describedBy = useId();
  const toast = useToastIfAny();
  const soon = props.soon ? soonText(props.soon) : undefined;
  // A part to come is never disabled: it can be reached, and says why it does not act yet.
  const disabled = props.disabled && !soon;
  const title = soon ?? props.title ?? (iconOnly ? label : kbd ? `${label.replace(/^\+\s*/, '')} (raccourci : ${kbd})` : undefined);
  const look = {
    className: css.root,
    style: layout,
    title,
    'aria-label': props.ariaLabel ?? (iconOnly ? label : undefined),
    'aria-describedby': soon ? describedBy : undefined,
    'data-variant': variant,
    'data-size': size,
    'data-full': full || undefined,
    'data-icon-only': iconOnly || undefined,
    'data-soon': soon ? true : undefined,
    'data-ph-key': kbd?.toUpperCase(),
  };
  const content: ReactNode = (
    <>
      {loading && <span aria-hidden className={css.spinner} />}
      {icon && !loading && <Icone icon={icon} size={ICON_SIZE[size]} />}
      {!iconOnly && <span>{label}</span>}
      {count !== undefined && count !== '' && <span className={css.count}>{count}</span>}
      {/* The tag is seen; a screen reader hears the whole sentence, as the description of the button. */}
      {soon && !iconOnly && variant !== 'link' && size !== 'xs' && (
        <span aria-hidden className={css.soon}>
          Bientôt
        </span>
      )}
      {soon && (
        <span id={describedBy} hidden>
          {soon}
        </span>
      )}
      {kbd && <kbd className={css.kbd}>{kbd}</kbd>}
      {iconRight && <Icone icon={iconRight} size={ICON_SIZE[size]} />}
    </>
  );
  // tokens.css recolours every link in dark mode; an inline colour keeps the button variant.
  const linkStyle = { ...layout, color: 'var(--c-fg)' };
  if (href && !disabled) {
    if (href.startsWith('/'))
      return (
        <Link to={href} onClick={onPress} {...look} style={linkStyle}>
          {content}
        </Link>
      );
    return (
      <a href={href} onClick={onPress} {...look} style={linkStyle}>
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
        if (soon) toast?.({ message: soon, tone: 'info' });
        else if (!loading) onPress?.(event);
        else event.preventDefault();
      }}
    >
      {content}
    </UnstyledButton>
  );
}
