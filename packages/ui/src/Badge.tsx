import { Badge as MantineBadge } from '@mantine/core';
import { Icone } from './Icone';
import type { IconName } from './icons';
import tones from './tones.module.css';
import type { LayoutProps, Tone } from './types';
import css from './Badge.module.css';

export interface BadgeProps extends LayoutProps {
  label: string;
  tone?: Tone;
  variant?: 'soft' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  dot?: boolean;
  icon?: IconName;
  title?: string;
}

export function Badge({ label, tone = 'neutral', variant = 'soft', size = 'sm', dot, icon, title, layout }: BadgeProps) {
  return (
    <MantineBadge
      unstyled
      component="span"
      title={title}
      data-tone={tone}
      data-look={variant}
      data-size={size}
      className={`${tones.tone} ${css.root}`}
      style={layout}
    >
      {dot && <span aria-hidden className={css.dot} />}
      {icon && <Icone icon={icon} size={size === 'md' ? 14 : 12} />}
      {label}
    </MantineBadge>
  );
}
