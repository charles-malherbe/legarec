import { notificationItem, REQUEST_BODIES, ROLE_LABELS, type NotificationItem, type Role } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AnyStaff } from '../../platform/access/access';
import { Database } from '../../platform/database/database';
import { ago, capitalized, daysAgo, timeOf } from '../../platform/format';
import type { SupportAction } from '../members/members.service';

const bodies = REQUEST_BODIES.staff;
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
const TEAM = { href: '/equipe', cta: 'Ouvrir l’équipe' };

@ApiTags('notifications')
@Controller('staff/notifications')
@AnyStaff()
export class NotificationsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  @ApiOkResponse({ standardSchema: z.array(notificationItem) })
  async list(): Promise<NotificationItem[]> {
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
        },
        orderBy: { createdAt: 'desc' },
        take,
      });
    // Those that were read give way: nothing unread is pushed out by them.
    const unread = await some(null, SHOWN);
    const found = [...unread, ...(await some({ not: null }, SHOWN - unread.length))].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const now = new Date();
    return found.map(({ id, userId, kind, action, createdAt, readAt, actor, target, ticket }) => {
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

  @Put()
  @HttpCode(204)
  @ApiNoContentResponse()
  async mark(@Body({ schema: bodies['PUT /notifications'] }) { ids, unread }: z.infer<(typeof bodies)['PUT /notifications']>) {
    await this.read(ids, unread);
  }

  @Post('read')
  @HttpCode(204)
  @ApiNoContentResponse()
  async markRead(@Body({ schema: bodies['POST /notifications/read'] }) { ids }: z.infer<(typeof bodies)['POST /notifications/read']>) {
    await this.read(ids, false);
  }

  private async read(ids: string[], unread: boolean): Promise<void> {
    await this.database.tx.notification.updateMany({
      where: { id: { in: ids }, readAt: unread ? { not: null } : null },
      data: { readAt: unread ? null : new Date() },
    });
  }
}
