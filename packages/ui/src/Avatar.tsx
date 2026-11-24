import { Avatar as MantineAvatar } from '@mantine/core';
import tones from './tones.module.css';
import css from './Avatar.module.css';
import type { LayoutProps, Tone } from './types';

export interface AvatarProps extends LayoutProps {
  initials?: string;
  title: string;
  size?: 24 | 32 | 40 | 48;
  tone?: Tone;
  presence?: 'call' | 'dispo' | 'pause' | 'off';
}
const PRESENCE = { call: 'En appel', dispo: 'Disponible', pause: 'En pause', off: 'Hors ligne' } as const;

export function Avatar({ initials, title, size = 40, tone = 'marine', presence, layout }: AvatarProps) {
  const text = (
    initials ??
    title
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
  ).toUpperCase();
  return (
    <span className={`${tones.tone} ${css.root}`} data-tone={tone} data-size={size} title={title} style={layout}>
      <MantineAvatar unstyled component="span" role="img" aria-label={presence ? `${title}, ${PRESENCE[presence]}` : title} className={css.disc}>
        {text}
      </MantineAvatar>
      {presence && <span aria-hidden className={css.presence} data-presence={presence} />}
    </span>
  );
}
