import { useRef, type ReactNode } from 'react';
import { Bouton } from './Bouton';
import { Icone } from './Icone';
import { Onglets, type OngletItem } from './Onglets';
import { useShortcut } from './shortcuts';
import css from './Toolbar.module.css';

export interface ToolbarFilter {
  label: string;
  value: string;
  options: (string | { value: string; label: string })[];
  onChange: (value: string) => void;
}
export interface ToolbarProps {
  label?: string;
  tabs?: OngletItem[];
  tabsLabel?: string;
  placeholder?: string;
  filters?: ToolbarFilter[];
  views?: { label: string; selected: boolean; pick: () => void }[];
  period?: { label: string; prev: () => void; next: () => void; today: () => void; prevLabel?: string; nextLabel?: string };
  note?: string;
  noSearch?: boolean;
  digitKeys?: boolean;
  query?: string;
  onQuery?: (value: string) => void;
  /** Scope set by the « Créancier actif » switch of the sidebar. */
  scope?: { name: string; onReset?: () => void };
  children?: ReactNode;
}

export function Toolbar({
  label = 'Filtres',
  tabs = [],
  tabsLabel = 'Filtrer',
  placeholder = 'Rechercher…',
  filters = [],
  views = [],
  period,
  note,
  noSearch,
  digitKeys = true,
  query = '',
  onQuery,
  scope,
  children,
}: ToolbarProps) {
  const input = useRef<HTMLInputElement>(null);
  useShortcut((event) => {
    if (event.key.toLowerCase() === 'f' && input.current) {
      event.preventDefault();
      input.current.focus();
      return;
    }
    const digit = /^Digit([1-9])$/.exec(event.code);
    const tab = digit && !event.shiftKey && digitKeys ? tabs[Number(digit[1]) - 1] : undefined;
    if (tab) {
      event.preventDefault();
      tab.pick();
    }
  });
  return (
    <div role="toolbar" aria-label={label} className={css.root}>
      {period && (
        <div className={css.group}>
          <Bouton variant="secondary" icon="chevron-left" iconOnly label={period.prevLabel ?? 'Période précédente'} onPress={period.prev} />
          <span aria-live="polite" className={css.period}>
            {period.label}
          </span>
          <Bouton variant="secondary" icon="chevron-right" iconOnly label={period.nextLabel ?? 'Période suivante'} onPress={period.next} />
          <Bouton variant="secondary" label="Aujourd'hui" onPress={period.today} />
        </div>
      )}
      {tabs.length > 0 && (
        <Onglets items={tabs.map((tab, index) => ({ ...tab, tip: digitKeys && index < 9 ? `Raccourci : ${index + 1}` : undefined }))} label={tabsLabel} />
      )}
      {!noSearch && (
        <label className={css.search}>
          <Icone icon="search" size={16} />
          <span className={css.hidden}>{placeholder.replace(/…$/, '')}</span>
          <input
            ref={input}
            type="search"
            value={query}
            placeholder={placeholder}
            className={css.input}
            onChange={(event) => onQuery?.(event.currentTarget.value)}
          />
          <kbd className={css.kbd}>F</kbd>
        </label>
      )}
      {children}
      <div className={css.right}>
        {scope && (
          <span
            className={css.scope}
            title="Périmètre défini par le sélecteur « Créancier actif » du menu latéral"
            data-reset={scope.onReset ? true : undefined}
          >
            Créancier : <strong>{scope.name}</strong>
            {scope.onReset && <Bouton label="Revenir à tous les créanciers" icon="x" iconOnly variant="ghost" size="xs" onPress={scope.onReset} />}
          </span>
        )}
        {filters.map((filter) => (
          <select
            key={filter.label}
            aria-label={filter.label}
            value={filter.value}
            className={css.select}
            onChange={(event) => filter.onChange(event.currentTarget.value)}
          >
            {filter.options.map((option) =>
              typeof option === 'string' ? (
                <option key={option}>{option}</option>
              ) : (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ),
            )}
          </select>
        ))}
        {views.length > 0 && (
          <div role="group" aria-label="Affichage" className={css.views}>
            {views.map((view) => (
              <button key={view.label} type="button" aria-pressed={view.selected} className={css.view} onClick={view.pick}>
                {view.label}
              </button>
            ))}
          </div>
        )}
        {note && <span className={css.note}>{note}</span>}
      </div>
    </div>
  );
}
