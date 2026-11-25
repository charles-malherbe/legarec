import { Bouton } from './Bouton';
import { Icone } from './Icone';
import css from './EtatListe.module.css';

export interface EtatListeProps {
  kind?: 'empty' | 'noresult' | 'loading' | 'error';
  title?: string;
  text?: string;
  actionLabel?: string;
  onAction?: () => void;
  count?: number;
  compact?: boolean;
}
const KINDS = {
  empty: { title: 'Rien pour le moment', text: 'Les éléments apparaîtront ici dès qu’ils seront créés.', icon: 'box', action: '' },
  noresult: {
    title: 'Aucun résultat',
    text: 'Aucun élément ne correspond à votre recherche ou à vos filtres.',
    icon: 'search-minus',
    action: 'Effacer la recherche',
  },
  error: {
    title: 'Chargement impossible',
    text: 'Le serveur n’a pas répondu. Vos données ne sont pas perdues : réessayez dans quelques instants.',
    icon: 'alert',
    action: 'Réessayer',
  },
} as const;
const WIDTHS = ['62%', '48%', '70%', '55%', '66%', '40%'];

export function EtatListe({ kind = 'empty', title, text, actionLabel, onAction, count = 4, compact }: EtatListeProps) {
  if (kind === 'loading') {
    return (
      <div role="status" aria-busy className={css.root} data-compact={compact || undefined}>
        <div className={css.rows}>
          <span className={css.hidden}>Chargement en cours…</span>
          {Array.from({ length: count }, (_, index) => (
            <div key={index} className={css.row}>
              <span data-skeleton className={css.disc} />
              <span className={css.lines}>
                <span data-skeleton style={{ height: 12, width: WIDTHS[index % 6] }} />
                <span data-skeleton style={{ height: 10, width: WIDTHS[(index + 3) % 6] }} />
              </span>
              <span data-skeleton className={css.end} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  const preset = KINDS[kind];
  const label = actionLabel ?? preset.action;
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={css.root} data-compact={compact || undefined}>
      <div className={css.message}>
        <span className={css.icon} data-kind={kind}>
          <Icone icon={preset.icon} size={20} stroke={1.7} />
        </span>
        <span className={css.title}>{title ?? preset.title}</span>
        <span className={css.text}>{text ?? preset.text}</span>
        {label && onAction && <Bouton variant="secondary" label={label} onPress={onAction} layout={{ marginTop: 'var(--sp-2)' }} />}
      </div>
    </div>
  );
}
