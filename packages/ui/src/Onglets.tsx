import { UnstyledButton } from '@mantine/core';
import type { KeyboardEvent } from 'react';
import css from './Onglets.module.css';
import type { LayoutProps } from './types';

export interface OngletItem {
  label: string;
  count?: string | number;
  selected: boolean;
  tip?: string;
  controls?: string;
  pick: () => void;
}
export interface OngletsProps extends LayoutProps {
  items: OngletItem[];
  variant?: 'segment' | 'underline';
  label?: string;
}

export function Onglets({ items, variant = 'segment', label = 'Filtrer', layout }: OngletsProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((item) => item.selected);
    const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: items.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const index = (next + items.length) % items.length;
    items[index]?.pick();
    event.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')[index]?.focus();
  };
  const none = !items.some((item) => item.selected);
  return (
    <div role="tablist" aria-label={label} className={css.root} data-variant={variant} style={layout} onKeyDown={onKeyDown} tabIndex={-1}>
      {items.map((item, index) => (
        <UnstyledButton
          key={item.label}
          role="tab"
          aria-selected={item.selected}
          aria-controls={item.controls}
          tabIndex={item.selected || (none && index === 0) ? 0 : -1}
          title={item.tip}
          className={css.tab}
          onClick={item.pick}
        >
          {item.label}
          {item.count !== undefined && item.count !== '' && <span className={css.count}>{item.count}</span>}
        </UnstyledButton>
      ))}
    </div>
  );
}
