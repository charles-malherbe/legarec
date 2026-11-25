import type { CSSProperties } from 'react';
import { ICONS, type IconName } from './icons';

export interface IconeProps {
  icon: IconName;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  layout?: CSSProperties;
}

export function Icone({ icon, size = 18, stroke = 2, color = 'currentColor', label, layout }: IconeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ flexShrink: 0, ...layout }}
    >
      <path d={ICONS[icon]} />
    </svg>
  );
}
