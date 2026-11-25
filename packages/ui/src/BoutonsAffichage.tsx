import { Icone } from './Icone';
import css from './PageConnexion.module.css';

export interface BoutonsAffichageProps {
  dark: boolean;
  lowVision: boolean;
  onDark: (next: boolean) => void;
  onLowVision: (next: boolean) => void;
}

/** « Aa » (low vision) and moon (dark mode) buttons of the public screens. */
export function BoutonsAffichage({ dark, lowVision, onDark, onLowVision }: BoutonsAffichageProps) {
  return (
    <span role="group" aria-label="Affichage" className={css.display}>
      <button
        type="button"
        aria-pressed={lowVision}
        title="Texte agrandi et contraste renforcé"
        aria-label="Aa Texte agrandi"
        onClick={() => onLowVision(!lowVision)}
      >
        Aa
      </button>
      <button type="button" aria-pressed={dark} title="Mode sombre" aria-label="Mode sombre" onClick={() => onDark(!dark)}>
        <Icone icon="moon" size={16} stroke={1.7} />
      </button>
    </span>
  );
}
