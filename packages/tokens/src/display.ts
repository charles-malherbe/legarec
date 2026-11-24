export type ThemeChoice = 'light' | 'dark' | 'system';

/** Applies theme and low-vision mode on <html>, the only place read by tokens.css. */
export function applyDisplay(choice: ThemeChoice, lowVision: boolean): void {
  const root = document.documentElement;
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  if (lowVision) root.dataset.a11y = 'malvoyant';
  else delete root.dataset.a11y;
}
