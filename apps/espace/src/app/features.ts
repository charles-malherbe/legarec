/**
 * Parts of the portal whose routes the API does not answer yet. A production build shows them greyed with « Bientôt »,
 * still reachable (DECISIONS.md, 28/11/2026, in place of the hiding of decision 194), unless `VITE_FEATURES` names them
 * (`calls,emails`); development, which simulates them, has them all ready, unless `VITE_FEATURES` is set. What each one
 * greys, and how to make it ready: `docs/deploiement.md`, « Avant la mise en service : écrans encore sans API ».
 */
export const FEATURES = ['calls', 'emails', 'sms', 'mailboxes', 'letters', 'document-sending', 'template-tests'] as const;
export type Feature = (typeof FEATURES)[number];

/** What a part waits for, said by its greyed buttons (after « Bientôt disponible : ») and by its page. */
export const SOON: Record<Feature, string> = {
  calls: 'la téléphonie (3CX) n’est pas encore reliée à l’espace.',
  emails: 'les boîtes e-mail du cabinet ne sont pas encore reliées à l’espace.',
  sms: 'le compte SMS du cabinet n’est pas encore relié à l’espace.',
  mailboxes: 'les boîtes e-mail du cabinet ne sont pas encore reliées à l’espace.',
  letters: 'la rédaction et l’envoi des courriers ne sont pas encore reliés à l’espace.',
  'document-sending': 'l’envoi des documents n’est pas encore relié à l’espace.',
  'template-tests': 'l’envoi d’un test n’est pas encore relié à l’espace.',
};

/** The screens of these parts: in a build without them, their address opens « Bientôt disponible », never an error. */
const SCREENS: [string, Feature][] = [
  ['/appels', 'calls'],
  ['/e-mails', 'emails'],
  ['/sms', 'sms'],
  ['/documents/rediger', 'letters'],
  ['/parametres/techniques/boites', 'mailboxes'],
];

const named = (list: string) => list.split(',').flatMap((name) => name.trim() || []);

/** Names that are no part of the portal: the build refuses them, rather than leave a part greyed for a typing error. */
export const unknownFeatures = (list = ''): string[] => named(list).filter((name) => !(FEATURES as readonly string[]).includes(name));

/** Whether the API of a part is ready in this build. Read at each call: fixed by the build, changed by the tests. */
export function ready(feature: Feature): boolean {
  const list = import.meta.env.VITE_FEATURES as string | undefined;
  return list === undefined ? import.meta.env.DEV : named(list).includes(feature);
}

/** « Bientôt » of a button of a part: what the part waits for, or nothing once it is ready. */
export const soon = (feature: Feature): string | undefined => (ready(feature) ? undefined : SOON[feature]);

/** The part, not ready in this build, whose screen an address of the portal opens. */
export function pending(href: string): Feature | undefined {
  const [path = ''] = href.split(/[?#]/u, 1);
  return SCREENS.find(([screen, feature]) => (path === screen || path.startsWith(`${screen}/`)) && !ready(feature))?.[1];
}

/** « Bientôt » of a link to a screen: what its part waits for, or nothing when the screen is ready. */
export function soonAt(href: string): string | undefined {
  const feature = pending(href);
  return feature && SOON[feature];
}
