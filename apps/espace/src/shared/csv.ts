/** Spreadsheet-safe CSV: quotes every cell and neutralises formulas. */
export const toCsv = (columns: string[], rows: string[][]) =>
  [columns, ...rows].map((row) => row.map((cell) => `"${(/^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell).replaceAll('"', '""')}"`).join(';')).join('\r\n');
