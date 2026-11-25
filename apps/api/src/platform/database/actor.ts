import type { Delegation, Role } from '@legarec/contracts';

/** Who is acting. The kind decides the PostgreSQL role of the transaction; the rest feeds the row-level security. */
export type Actor =
  | { kind: 'anonymous' }
  | { kind: 'staff'; userId: string; role: Exclude<Role, 'CREDITOR'>; delegations: readonly Delegation[]; actingFor?: Delegation }
  | { kind: 'partner'; userId: string; creditorId: string }
  | { kind: 'debtor'; debtorId: string }
  | { kind: 'hook' }
  | { kind: 'public' }
  | { kind: 'service'; accountId: string }
  | { kind: 'worker'; job: string }
  | { kind: 'retention' };

export type ActorKind = Actor['kind'];

export const DATABASE_ROLE: Record<ActorKind, string> = {
  anonymous: 'legarec_auth',
  staff: 'legarec_staff',
  partner: 'legarec_partner',
  debtor: 'legarec_debtor',
  hook: 'legarec_hook',
  public: 'legarec_public',
  service: 'legarec_service',
  worker: 'legarec_worker',
  retention: 'legarec_retention',
};

/** Facts about the request kept with the audit log. Never a path, a query string or a body. */
export interface RequestFacts {
  requestId?: string;
  ip?: string;
}

/** Every context variable is set, even to an empty value: nothing is inherited from a previous transaction. */
export function contextOf(actor: Actor, facts: RequestFacts): Record<string, string> {
  return {
    'app.user_id': actor.kind === 'staff' || actor.kind === 'partner' ? actor.userId : '',
    'app.creditor_id': actor.kind === 'partner' ? actor.creditorId : '',
    'app.debtor_id': actor.kind === 'debtor' ? actor.debtorId : '',
    'app.acting_for': actor.kind === 'staff' ? (actor.actingFor ?? '') : '',
    'app.job': actor.kind === 'worker' ? actor.job : actor.kind === 'retention' ? 'retention' : '',
    'app.service': actor.kind === 'service' ? actor.accountId : '',
    'app.purging': '',
    'app.ip': facts.ip ?? '',
    'app.request_id': facts.requestId ?? '',
    // Last: from here on the statements run with the rights of that actor only.
    role: DATABASE_ROLE[actor.kind],
  };
}
