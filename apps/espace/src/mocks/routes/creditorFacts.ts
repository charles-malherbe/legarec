import type { CaseCheckResult } from '@legarec/contracts';

type Mandate = NonNullable<CaseCheckResult['mandate']>;
/** What the cases need of the creditors, given by their own simulations: neither file imports the other. */
export const creditorFacts = {
  list: (): { id: string; name: string }[] => [],
  mandateOf: (_creditorId: string): Mandate | null => null,
  nextOf: (_creditorId: string): string | null => null,
};
