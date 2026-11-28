import { useSearchParams } from 'react-router';

/**
 * The tab of a page kept in its address (`?onglet=`, in French like the routes), so that a link opens the page on the
 * section it names, and a reload or the back button keeps it (DECISIONS.md, 28/11/2026). `slugs`: the word of each tab
 * in the address. An address without one, or with a word the page does not know, opens `fallback`, whose address stays
 * bare. Picking a tab replaces the address instead of adding a step: back leaves the page.
 */
export function useTabParam<T extends string>(slugs: Readonly<Record<T, string>>, fallback: NoInfer<T>): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const asked = params.get('onglet');
  const tab = (Object.keys(slugs) as T[]).find((id) => slugs[id] === asked) ?? fallback;
  const pick = (next: T) =>
    setParams(
      (current) => {
        const kept = new URLSearchParams(current);
        if (next === fallback) kept.delete('onglet');
        else kept.set('onglet', slugs[next]);
        return kept;
      },
      { replace: true, preventScrollReset: true },
    );
  return [tab, pick];
}
