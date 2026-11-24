/** Rows of the current page; a filter that shortens the list brings back to the last existing page. */
export function pageOf<T>(rows: T[], page: number, size: number) {
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / size)));
  return { shown: rows.slice((current - 1) * size, current * size), current, total: rows.length };
}
