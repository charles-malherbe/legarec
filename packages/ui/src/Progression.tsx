import { Progress } from '@mantine/core';
import css from './Progression.module.css';
import type { LayoutProps } from './types';

export interface ProgressionProps extends LayoutProps {
  value: number;
  tone?: 'or' | 'marine' | 'success' | 'warning' | 'danger' | 'info';
  label?: string;
  size?: 'sm' | 'md';
  showValue?: boolean;
}

export function Progression({ value, tone = 'or', label = 'Progression', size = 'sm', showValue, layout }: ProgressionProps) {
  const now = Math.max(0, Math.min(100, Math.round(value) || 0));
  return (
    <div className={css.root} style={layout}>
      <Progress.Root unstyled className={css.track} attributes={{ root: { 'data-size': size } }}>
        <Progress.Section value={now} aria-label={label} className={css.bar} data-tone={tone} style={{ width: `${now}%` }} />
      </Progress.Root>
      {showValue && <span className={css.value}>{now} %</span>}
    </div>
  );
}
