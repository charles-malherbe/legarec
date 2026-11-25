import { Progression, type ProgressionProps } from './Progression';
import css from './Indicateur.module.css';
import type { LayoutProps } from './types';

type IndicTone = 'default' | 'success' | 'danger' | 'warning' | 'marine';
export interface IndicateurProps extends LayoutProps {
  label: string;
  value: string;
  sub?: string;
  tone?: IndicTone;
  subTone?: IndicTone;
  bar?: number;
  barTone?: ProgressionProps['tone'];
  loading?: boolean;
  variant?: 'tile' | 'cell';
  size?: 'md' | 'lg';
}

export function Indicateur({
  label,
  value,
  sub,
  tone = 'default',
  subTone = 'default',
  bar,
  barTone = 'or',
  loading,
  variant = 'tile',
  size = 'md',
  layout,
}: IndicateurProps) {
  return (
    <div className={css.root} data-variant={variant} style={layout}>
      <span className={css.label}>{label}</span>
      {loading ? (
        <span data-skeleton className={css.skeleton} />
      ) : (
        <span title={value} className={css.value} data-tone={tone} data-size={size}>
          {value}
        </span>
      )}
      {bar !== undefined && <Progression value={bar} tone={barTone} label={label} />}
      {sub && (
        <span className={css.sub} data-tone={subTone}>
          {sub}
        </span>
      )}
    </div>
  );
}
