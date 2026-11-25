import { createContext, use, useState, type ReactNode } from 'react';

interface Scope {
  id: string;
  setId: (id: string) => void;
}
const ScopeContext = createContext<Scope>({ id: 'all', setId: () => {} });

/** « Créancier actif » of the sidebar: the only creditor filter of the espace. */
export function CreditorScopeProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState('all');
  return <ScopeContext value={{ id, setId }}>{children}</ScopeContext>;
}
export const useCreditorScope = () => use(ScopeContext);
