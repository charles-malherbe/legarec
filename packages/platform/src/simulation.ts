const named = (list: string | undefined) => (list ?? '').split(',').flatMap((name) => name.trim() || []);

/**
 * Development only: routes that go to the API of this machine, the others staying simulated. `VITE_API` lists the first
 * part of their paths (`auth,account,members`); empty, everything is simulated.
 */
export const answeredByApi = (url: string, list = import.meta.env.VITE_API as string | undefined): boolean =>
  named(list).includes(new URL(url).pathname.split('/')[2] ?? '');
