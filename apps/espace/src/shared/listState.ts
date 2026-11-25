import type { EtatListeProps } from '@legarec/ui';

interface Input {
  pending: boolean;
  error: unknown;
  count: number;
  query?: string;
  empty: string;
  emptyText: string;
  noResultText?: string;
  errorTitle?: string;
  onRetry: () => void;
  onClear?: () => void;
}

/** The four states shared by every list: loading, error, no result, empty. */
export function listState({
  pending,
  error,
  count,
  query = '',
  empty,
  emptyText,
  noResultText,
  errorTitle,
  onRetry,
  onClear,
}: Input): EtatListeProps | undefined {
  if (pending) return { kind: 'loading', count: 6 };
  if (error) return { kind: 'error', title: errorTitle, onAction: onRetry };
  if (count > 0) return undefined;
  if (query.trim()) return { kind: 'noresult', title: `Aucun résultat pour « ${query.trim()} »`, text: noResultText, onAction: onClear };
  return { kind: 'empty', title: empty, text: emptyText };
}

/** Filters on every visible field, ignoring accents, and spaces for SIRET/SIREN numbers. */
export function matches(query: string, ...fields: (string | number | null | undefined)[]): boolean {
  const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const q = normalize(query.trim());
  if (!q) return true;
  const text = normalize(fields.filter((field) => field !== null && field !== undefined).join(' '));
  const compact = q.replace(/\s/g, '');
  return text.includes(q) || (compact.length >= 3 && text.replace(/\s/g, '').includes(compact));
}
