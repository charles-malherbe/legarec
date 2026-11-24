import css from './Case.module.css';
import type { LayoutProps } from './types';

export interface CaseProps extends LayoutProps {
  checked: boolean;
  label: string;
  description?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  indeterminate?: boolean;
  onToggle?: (next: boolean) => void;
}

export function Case({ checked, label, description, disabled, hideLabel, indeterminate, onToggle, layout }: CaseProps) {
  return (
    <label className={css.root} style={layout}>
      <input
        type="checkbox"
        className={css.input}
        checked={checked}
        disabled={disabled}
        aria-label={hideLabel ? label : undefined}
        ref={(node) => {
          if (node) node.indeterminate = !!indeterminate;
        }}
        onChange={(event) => onToggle?.(event.currentTarget.checked)}
      />
      {!hideLabel && (
        <span className={css.text}>
          <span className={css.label}>{label}</span>
          {description && <span className={css.description}>{description}</span>}
        </span>
      )}
    </label>
  );
}
