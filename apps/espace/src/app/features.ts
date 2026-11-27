/**
 * Parts of the portal whose routes the API does not answer yet (decision 194). A production build leaves them out,
 * unless `VITE_FEATURES` names them (`calls,emails`); development, which simulates them, shows them all, unless
 * `VITE_FEATURES` is set. What each one hides, and how to show it again: `docs/deploiement.md`, « Avant la mise en service :
 * écrans encore sans API ».
 */
export const FEATURES = ['calls', 'emails', 'sms', 'mailboxes', 'letters', 'document-sending', 'installment-reminders', 'template-tests'] as const;
export type Feature = (typeof FEATURES)[number];

/** Screens of these parts: left out, their address leads to « Page introuvable ». */
const SCREENS: [string, Feature][] = [
  ['/appels', 'calls'],
  ['/e-mails', 'emails'],
  ['/sms', 'sms'],
  ['/documents/rediger', 'letters'],
  ['/parametres/techniques/boites', 'mailboxes'],
];

const named = (list: string) => list.split(',').flatMap((name) => name.trim() || []);

/** Names that are no part of the portal: the build refuses them, rather than leave a part out for a typing error. */
export const unknownFeatures = (list = ''): string[] => named(list).filter((name) => !(FEATURES as readonly string[]).includes(name));

/** Read at each call: fixed by the build, changed by the tests. */
export function shown(feature: Feature): boolean {
  const list = import.meta.env.VITE_FEATURES as string | undefined;
  return list === undefined ? import.meta.env.DEV : named(list).includes(feature);
}

/** Whether an address of the portal leads to a screen of this build. */
export function opens(href: string): boolean {
  const [path = ''] = href.split(/[?#]/u, 1);
  return SCREENS.every(([screen, feature]) => (path !== screen && !path.startsWith(`${screen}/`)) || shown(feature));
}
