import type { Seed } from './database';

/** Callers of the test set. `managerAlone` has lost the delegation; `liar` announces rights the table does not give. */
export type Caller =
  'nobody' | 'director' | 'manager' | 'managerAlone' | 'developer' | 'officerA' | 'officerB' | 'liar' | 'partnerA' | 'partnerB' | 'debtorA' | 'debtorB';

export interface MatrixEntry {
  /** Real path, for a route with parameters. */
  path?: (s: Seed) => string;
  body?: unknown;
  expect: Record<Caller, number>;
}

const everyone = (status: number): Record<Caller, number> => ({
  nobody: status,
  director: status,
  manager: status,
  managerAlone: status,
  developer: status,
  officerA: status,
  officerB: status,
  liar: status,
  partnerA: status,
  partnerB: status,
  debtorA: status,
  debtorB: status,
});

/** Every route of the API, with the answer expected for every caller. A route missing here fails `pnpm verifier`. */
export const MATRIX: Record<string, MatrixEntry> = {
  'GET /health': { expect: everyone(200) },
};
