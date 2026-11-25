import { ROLE_LABELS, type NotificationItem, type Role } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../../platform/database/database';
import { ago, capitalized, daysAgo, timeOf } from '../../platform/format';
import type { SupportAction } from '../members/members.service';

type Person = { id: string; firstName: string; lastName: string; role: Role } | null;
const name = (person: Person) => (person ? `${person.firstName} ${person.lastName}` : 'Un collaborateur');
/** With the role: a name may be changed by its holder. */
const signed = (person: Person) => (person ? `${name(person)} (${ROLE_LABELS[person.role]})` : name(person));

/** Sentences written when they are read: nothing but facts is stored. */
const SUPPORT: Record<SupportAction, (of: string) => string> = {
  RESET_LINK: (of) => `a envoyé un lien de réinitialisation ${of === '' ? 'à votre adresse' : `à ${of}`}`,
  SECOND_FACTOR_REQUIRED: (of) => `a exigé la double authentification ${of === '' ? 'pour votre compte' : `pour ${of}`}`,
  SECOND_FACTOR_RESET: (of) => `a réinitialisé la double authentification ${of === '' ? 'de votre compte' : `de ${of}`}`,
  ACCOUNT_UNLOCKED: (of) => `a débloqué ${of === '' ? 'votre compte' : `le compte de ${of}`}`,
};

const SHOWN = 500;
const JOURNAL = { href: '/parametres/techniques/audit', cta: 'Voir le journal' };
const HERE = { href: '/notifications', cta: 'Voir les notifications' };
const TEAM = { href: '/equipe', cta: 'Ouvrir l’équipe' };

@Injectable()
export class NotificationsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async list(shown = SHOWN): Promise<NotificationItem[]> {
    const person = { select: { id: true, firstName: true, lastName: true, role: true } } as const;
    const some = (readAt: null | { not: null }, take: number) =>
      this.database.tx.notification.findMany({
        where: { readAt },
        select: {
          id: true,
          userId: true,
          kind: true,
          action: true,
          createdAt: true,
          readAt: true,
          actor: person,
          target: person,
          ticket: { select: { number: true, subject: true } },
          caseCount: true,
          planId: true,
          // Null when this person no longer reads it.
          case: { select: { id: true, reference: true, debtor: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      });
    // Those that were read give way: nothing unread is pushed out by them.
    const unread = await some(null, shown);
    const found = [...unread, ...(await some({ not: null }, shown - unread.length))].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const now = new Date();
    const plans = new Map(
      (
        await this.database.tx.paymentPlan.findMany({
          where: { id: { in: found.flatMap((item) => (item.planId ? [item.planId] : [])) } },
          select: { id: true, status: true },
        })
      ).map((plan) => [plan.id, plan.status]),
    );
    return found.map(({ id, userId, kind, action, createdAt, readAt, actor, target, ticket, caseCount, case: about, planId }) => {
      const day = daysAgo(createdAt, now);
      const self = target?.id === userId;
      const said = (): { text: string; meta: string; href: string; cta: string } => {
        switch (kind) {
          case 'SUPPORT_TICKET':
            return { text: `${signed(actor)} a écrit au support : ${ticket?.subject ?? ''}`, meta: `Demande ${ticket?.number ?? ''}`, ...TEAM };
          case 'PASSWORD_RESET':
            return {
              text: `Le mot de passe ${self ? 'de votre compte' : `de ${signed(target)}`} a été réinitialisé par le lien envoyé à ${self ? 'votre' : 'son'} adresse`,
              meta: 'Sécurité des comptes',
              ...JOURNAL,
            };
          case 'DELEGATION_ENDED':
            return {
              text: `${signed(actor)} a changé le titulaire du rôle Développeur : la délégation technique a pris fin`,
              meta: 'Délégations',
              href: '/compte',
              cta: 'Ouvrir mon compte',
            };
          case 'DEVELOPER_CHANGED':
            return { text: `${signed(actor)} a changé le titulaire du rôle Développeur`, meta: 'Équipe', ...TEAM };
          case 'CASE_ASSIGNED':
            return about
              ? {
                  text: `${signed(actor)} vous a attribué le dossier de ${about.debtor.name}`,
                  meta: `Dossier ${about.reference}`,
                  href: `/debiteurs/${about.id}`,
                  cta: 'Ouvrir le dossier',
                }
              : {
                  text: `${signed(actor)} vous a attribué ${caseCount === 1 ? 'un dossier' : `${caseCount} dossiers`}`,
                  meta: 'Attribution',
                  href: '/debiteurs',
                  cta: 'Voir les dossiers',
                };
          case 'PLAN_DECIDED': {
            const refused = planId !== null && plans.get(planId) === 'REFUSED';
            return {
              text: `${signed(actor)} a ${refused ? 'refusé' : 'validé'} l’échéancier ${about ? `de ${about.debtor.name}` : 'que vous avez proposé'}`,
              meta: about ? `Dossier ${about.reference}` : 'Échéanciers',
              href: '/echeanciers',
              cta: 'Voir les échéanciers',
            };
          }
          case 'SUBSTITUTE_NOTICE':
            return { text: `Absence de ${signed(target)} : ses dossiers ont reçu une nouveauté`, meta: 'Remplacement', ...HERE };
          default:
            return { text: `${signed(actor)} ${SUPPORT[action!](self ? '' : name(target))}`, meta: 'Support des comptes', ...JOURNAL };
        }
      };
      return {
        id,
        kind: 'SYSTEM',
        unread: readAt === null,
        day,
        time: day === 'EARLIER' ? capitalized(ago(createdAt, now)) : timeOf(createdAt),
        ...said(),
      };
    });
  }
}
