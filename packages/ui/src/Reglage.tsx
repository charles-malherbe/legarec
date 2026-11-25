import { useId, type ReactNode } from 'react';
import { Badge } from './Badge';
import { Champ, type ChampProps } from './Champ';
import { Interrupteur } from './Interrupteur';
import css from './Reglage.module.css';
import type { LayoutProps, Tone } from './types';

export interface ReglageProps extends LayoutProps {
  label: string;
  description?: string;
  kind?: 'switch' | 'value' | 'text' | 'select' | 'custom';
  checked?: boolean;
  locked?: boolean;
  value?: string;
  options?: ChampProps['options'];
  status?: string;
  statusTone?: Tone;
  badge?: string;
  badgeTone?: Tone;
  suffix?: string;
  mono?: boolean;
  disabled?: boolean;
  first?: boolean;
  fieldId?: string;
  error?: string;
  onToggle?: (next: boolean) => void;
  onChange?: (value: string) => void;
  children?: ReactNode;
}

export function Reglage(props: ReglageProps) {
  const auto = useId();
  const id = props.fieldId ?? auto;
  const { kind = 'switch', label } = props;
  const field = kind === 'text' || kind === 'select';
  return (
    <div className={css.root} data-first={props.first || undefined} style={props.layout}>
      <div className={css.text}>
        <div className={css.heading}>
          {field ? (
            <label htmlFor={id} className={css.label}>
              {label}
            </label>
          ) : (
            <span className={css.label}>{label}</span>
          )}
          {props.badge && <Badge label={props.badge} tone={props.badgeTone ?? 'neutral'} />}
        </div>
        {props.description && <span className={css.description}>{props.description}</span>}
      </div>
      <div className={css.control} data-field={field || undefined}>
        {kind === 'switch' && (
          <Interrupteur checked={!!props.checked} locked={props.locked} label={label} disabled={props.disabled} onToggle={props.onToggle} />
        )}
        {kind === 'value' && <span className={css.value}>{props.value}</span>}
        {props.status && <Badge label={props.status} tone={props.statusTone ?? 'neutral'} />}
        {field && (
          <Champ
            fieldId={id}
            type={kind === 'select' ? 'select' : 'text'}
            value={props.value ?? ''}
            options={props.options}
            suffix={props.suffix}
            mono={props.mono}
            hideLabel
            label={label}
            error={props.error}
            disabled={props.disabled}
            onChange={props.onChange}
            layout={{ flex: 1 }}
          />
        )}
        {props.children}
      </div>
    </div>
  );
}
