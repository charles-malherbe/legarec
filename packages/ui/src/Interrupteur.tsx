import { UnstyledButton } from '@mantine/core';
import { Icone } from './Icone';
import css from './Interrupteur.module.css';
import type { LayoutProps } from './types';

export interface InterrupteurProps extends LayoutProps {
  checked: boolean;
  label: string;
  labelPosition?: 'none' | 'start' | 'end';
  disabled?: boolean;
  locked?: boolean;
  size?: 'sm' | 'md';
  onToggle?: (next: boolean) => void;
}

export function Interrupteur({ checked, label, labelPosition = 'none', disabled, locked, size = 'md', onToggle, layout }: InterrupteurProps) {
  const on = locked || checked;
  const text = <span className={css.label}>{label}</span>;
  return (
    <span className={css.root} style={layout}>
      {labelPosition === 'start' && text}
      <UnstyledButton
        role="switch"
        aria-checked={on}
        aria-label={label}
        aria-disabled={locked || undefined}
        disabled={disabled}
        title={locked ? 'Toujours actif : obligation légale ou de sécurité' : undefined}
        className={css.track}
        data-on={on || undefined}
        data-size={size}
        data-locked={locked || undefined}
        onClick={() => {
          if (!locked) onToggle?.(!on);
        }}
      >
        <span className={css.knob}>{locked && <Icone icon="lock" size={12} />}</span>
      </UnstyledButton>
      {labelPosition === 'end' && text}
    </span>
  );
}
