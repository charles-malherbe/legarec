import { Embleme } from './Embleme';
import css from './Marque.module.css';

export interface MarqueProps {
  /** Line under the name: « Cabinet de recouvrement » unless the portal names itself. */
  subtitle?: string;
  size?: 'md' | 'lg';
}

/**
 * The firm on the portals: the emblem of the media kit with the name set in the text of the page (DECISIONS.md,
 * 27/11/2026). The logo files of the kit are kept for official documents. Light or dark from the surface it sits on.
 */
export function Marque({ subtitle = 'Cabinet de recouvrement', size = 'md' }: MarqueProps) {
  return (
    <span className={css.root} data-size={size}>
      <Embleme size={size === 'lg' ? 44 : 32} />
      <span className={css.name}>
        <span className={css.title}>Legarec</span>
        <span className={css.subtitle}>{subtitle}</span>
      </span>
    </span>
  );
}
