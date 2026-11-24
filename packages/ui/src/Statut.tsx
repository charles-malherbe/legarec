import tones from './tones.module.css';
import css from './Statut.module.css';
import type { LayoutProps, Tone } from './types';

export interface StatutProps extends LayoutProps {
  label: string;
  tone?: Tone;
  pulse?: boolean;
  size?: 'sm' | 'md';
  strong?: boolean;
  live?: boolean;
  wrap?: boolean;
}

export function Statut({ label, tone = 'neutral', pulse, size = 'sm', strong, live, wrap, layout }: StatutProps) {
  return (
    <span
      role={live ? 'status' : undefined}
      data-tone={tone}
      data-size={size}
      data-strong={strong || undefined}
      data-wrap={wrap || undefined}
      className={`${tones.tone} ${css.root}`}
      style={layout}
    >
      <span aria-hidden className={css.dot} data-pulse={pulse || undefined} />
      {label}
    </span>
  );
}
