import { hasDelegation, type Delegation, type Session } from '@legarec/contracts';

export type AuditEntry = { date: string; who: string; onBehalfOf: string; what: string };
let entries: AuditEntry[] = [];
export const auditEntries = () => entries;
export const resetAudit = () => {
  entries = [];
};
/** Who, what, when, on whose behalf. Never a secret, a code nor a debtor's name. */
export const audit = (session: Session, what: string, delegation?: Delegation) => {
  entries = [
    {
      date: new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date()),
      who: `${session.firstName} ${session.lastName}`,
      onBehalfOf: delegation && hasDelegation(session, delegation) ? session.directorName : '',
      what,
    },
    ...entries,
  ];
};
