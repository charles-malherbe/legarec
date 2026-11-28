import { ROLE_LABELS } from '@legarec/contracts';
import type { Config } from '../../platform/config/config';
import { newToken } from '../../platform/crypto/keyring';
import type { Transaction } from '../../platform/database/database';
import { longMoment } from '../../platform/format';
import { GiveUp } from '../../platform/queue/errors';
import type { JobDefinition, Run } from '../../platform/queue/jobs';
import type { AccountMail } from './account-mail';
import type { AuthKeys } from './keys';
import { drawLink, linkUrl, type LinkPurpose } from './link-tokens';

type Portals = Pick<Config, 'STAFF_PORTAL_URL' | 'PARTNER_PORTAL_URL'>;
interface Parts {
  keys: AuthKeys;
  portals: Portals;
  /** Asked before a link is drawn: a refused e-mail draws none, and closes none of those already sent. */
  mail: AccountMail;
}
const person = { email: true, firstName: true, lastName: true, role: true, status: true } as const;
const id = (value: unknown): string => {
  if (typeof value !== 'string') throw new GiveUp('NO_IDENTIFIER');
  return value;
};
const fullName = (user: { firstName: string; lastName: string }) => `${user.firstName} ${user.lastName}`;

/** Whoever started it still administers or supports the accounts. */
const stillInCharge = async (tx: Transaction) => {
  const [row] = await tx.$queryRaw<{ may: boolean }[]>`SELECT app.acts_as_director('TECHNICAL', 'ADMINISTRATIVE') AS may`;
  return row?.may === true;
};
/** Told to the holder of the account, who started it themselves. */
const oneself = () => Promise.resolve(true);

/**
 * E-mails of the accounts, by Resend with the key of the reminders (question 217). A link is drawn here, when it leaves: it
 * is in no table, no queue and no log. Each reaches a person: one try, as in the queue of the reminders; an e-mail that
 * failed is asked again by whoever needs it (« Mot de passe oublié », a new invitation).
 */
export function accountJobs({ keys, portals, mail }: Parts): Record<string, JobDefinition> {
  const newLink = async (asApplication: Run, purpose: LinkPurpose, userId: string, role: string): Promise<string> => {
    const token = newToken();
    await asApplication((tx) => drawLink(tx, keys, { purpose, userId, token }));
    return linkUrl(portals, role, purpose, token);
  };

  return {
    invitation: {
      from: ['STAFF'],
      repeatable: false,
      run: async ({ taskId, payload, authorize }) => {
        const userId = id(payload.userId);
        const asApplication = await authorize(stillInCharge);
        const user = await asApplication((tx) =>
          tx.user.findUnique({
            where: { id: userId },
            select: { ...person, creditor: { select: { name: true } }, invitedBy: { select: { firstName: true, lastName: true } }, twoFactorRequired: true },
          }),
        );
        // Cancelled, or activated, since.
        if (user?.status !== 'INVITED') return;
        const deliver = await mail(user.email, taskId);
        const common = {
          invitation_url: await newLink(asApplication, 'INVITATION', userId, user.role),
          inviter: { name: user.invitedBy ? fullName(user.invitedBy) : 'Legarec' },
          recipient: { first_name: user.firstName },
          expires_in: '72 heures',
        };
        if (user.creditor) await deliver('creditor-invitation', { ...common, creditor: { name: user.creditor.name } });
        else await deliver('staff-invitation', { ...common, role_label: ROLE_LABELS[user.role], requires_2fa: user.twoFactorRequired });
      },
    },

    'reset-link': {
      from: ['ANONYMOUS', 'STAFF'],
      repeatable: false,
      run: async ({ taskId, payload, authorize }) => {
        const userId = id(payload.userId);
        const asApplication = await authorize(stillInCharge);
        const user = await asApplication((tx) => tx.user.findUnique({ where: { id: userId }, select: person }));
        if (user?.status !== 'ACTIVE') return;
        const deliver = await mail(user.email, taskId);
        await deliver(user.role === 'CREDITOR' ? 'creditor-password-reset' : 'staff-password-reset', {
          reset_url: await newLink(asApplication, 'RESET', userId, user.role),
          recipient: { first_name: user.firstName },
          requested_at: longMoment(new Date()),
          expires_in: '1 heure',
        });
      },
    },

    'new-device': {
      from: ['STAFF'],
      repeatable: false,
      run: async ({ taskId, payload, authorize }) => {
        const asApplication = await authorize(oneself);
        const session = await asApplication((tx) =>
          tx.userSession.findUnique({
            where: { id: id(payload.sessionId) },
            select: { deviceLabel: true, ip: true, createdAt: true, user: { select: person } },
          }),
        );
        if (!session) return;
        await (
          await mail(session.user.email, taskId)
        )('staff-new-device', {
          device: { name: session.deviceLabel, login_at: longMoment(session.createdAt), ...(session.ip ? { ip: session.ip } : {}) },
          recipient: { first_name: session.user.firstName },
          // Passwords and active sessions: the security tab of the account.
          secure_url: `${portals.STAFF_PORTAL_URL}/compte?onglet=securite`,
        });
      },
    },

    'second-factor-enabled': {
      from: ['STAFF'],
      repeatable: false,
      run: async ({ taskId, payload, authorize }) => {
        const asApplication = await authorize(oneself);
        const factor = await asApplication((tx) =>
          tx.secondFactor.findUnique({ where: { id: id(payload.factorId) }, select: { kind: true, confirmedAt: true, user: { select: person } } }),
        );
        if (!factor?.confirmedAt) return;
        await (
          await mail(factor.user.email, taskId)
        )('staff-2fa-enabled', {
          event: { date: longMoment(factor.confirmedAt), method_label: factor.kind === 'TOTP' ? 'Application d’authentification' : 'Clé de sécurité' },
          recipient: { first_name: factor.user.firstName },
        });
      },
    },

    'delegation-changed': {
      from: ['STAFF'],
      repeatable: false,
      run: async ({ taskId, payload, authorize }) => {
        const asApplication = await authorize(stillInCharge);
        const found = await asApplication(async (tx) => {
          const delegation = await tx.delegation.findUnique({
            where: { id: id(payload.delegationId) },
            select: { kind: true, grantedAt: true, withdrawnAt: true, grantedBy: { select: person } },
          });
          const role = delegation?.kind === 'TECHNICAL' ? 'DEVELOPER' : 'COLLECTION_MANAGER';
          return { delegation, holder: await tx.user.findFirst({ where: { role, status: 'ACTIVE' }, select: person }) };
        });
        const { delegation, holder } = found;
        if (!delegation || !holder) return;
        const director = fullName(delegation.grantedBy);
        await (
          await mail(holder.email, taskId)
        )('delegation-changed', {
          action_url: `${portals.STAFF_PORTAL_URL}/compte`,
          delegation: {
            from_name: director,
            to_name: fullName(holder),
            scope_label: delegation.kind === 'TECHNICAL' ? 'technique' : 'administrative',
            status_label: payload.active ? 'accordée' : 'retirée',
            changed_by: director,
            changed_at: longMoment(payload.active ? delegation.grantedAt : (delegation.withdrawnAt ?? new Date())),
          },
          recipient: { first_name: holder.firstName },
        });
      },
    },

    'support-ticket': {
      from: ['STAFF'],
      repeatable: false,
      run: async ({ taskId, payload, authorize }) => {
        const asApplication = await authorize(oneself);
        const found = await asApplication(async (tx) => {
          const ticket = await tx.supportTicket.findUnique({
            where: { id: id(payload.ticketId) },
            select: { number: true, subject: true, message: true, createdAt: true, user: { select: person } },
          });
          const [row] = await tx.$queryRaw<{ id: string | null }[]>`SELECT app.ticket_reader(${id(payload.ticketId)}::uuid) AS id`;
          return { ticket, reader: row?.id ? await tx.user.findUnique({ where: { id: row.id }, select: person }) : null };
        });
        const { ticket, reader } = found;
        if (!ticket || !reader) return;
        await (
          await mail(reader.email, taskId)
        )('ops-alert', {
          alert: {
            title: `Demande ${ticket.number} : ${ticket.subject}`,
            description: ticket.message,
            details: `De ${fullName(ticket.user)} (${ROLE_LABELS[ticket.user.role]})`,
            service: 'Support des collaborateurs',
            severity_label: 'Support',
            is_critical: false,
            started_at: longMoment(ticket.createdAt),
          },
        });
      },
    },
  };
}
