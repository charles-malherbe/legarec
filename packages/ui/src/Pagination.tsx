import { UnstyledButton } from '@mantine/core';
import { Bouton } from './Bouton';
import css from './Pagination.module.css';

export interface PaginationProps {
  total: number;
  page: number;
  size: number;
  unit?: string;
  label?: string;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}
const fr = (value: number) => value.toLocaleString('fr-FR');

export function Pagination({ total, page: rawPage, size, unit = 'éléments', label = 'Pagination', onPage, onSize }: PaginationProps) {
  const count = Math.max(1, Math.ceil(total / size));
  const page = Math.min(count, Math.max(1, rawPage));
  const numbers = [...new Set([1, page - 1, page, page + 1, count])].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);
  const from = (page - 1) * size + 1;
  return (
    <nav aria-label={label} className={css.root}>
      <span aria-live="polite" className={css.range}>
        {total === 0 ? `Aucun ${unit}` : `${fr(from)}–${fr(Math.min(total, page * size))} sur ${fr(total)} ${unit}`}
      </span>
      <div className={css.right}>
        <label className={css.size}>
          Lignes par page
          <select value={size} onChange={(event) => onSize(Number(event.currentTarget.value))} className={css.select}>
            {[25, 50, 100].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <div className={css.nav}>
          <Bouton variant="secondary" size="sm" icon="chevron-left" iconOnly label="Page précédente" disabled={page <= 1} onPress={() => onPage(page - 1)} />
          <span className={css.pages}>
            {numbers.map((n, index) => (
              <span key={n} className={css.nav}>
                {index > 0 && n - (numbers[index - 1] ?? 0) > 1 && <span className={css.gap}>…</span>}
                <UnstyledButton aria-label={`Page ${n}`} aria-current={n === page ? 'page' : undefined} className={css.page} onClick={() => onPage(n)}>
                  {n}
                </UnstyledButton>
              </span>
            ))}
          </span>
          <span className={css.compact}>
            Page {page} / {count}
          </span>
          <Bouton variant="secondary" size="sm" icon="chevron-right" iconOnly label="Page suivante" disabled={page >= count} onPress={() => onPage(page + 1)} />
        </div>
      </div>
    </nav>
  );
}
