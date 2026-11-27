import { PROVIDER, type EventKind } from '../../emails/resend-webhook';
import type { Transaction } from '../../platform/database/database';
import type { AppLogger } from '../../platform/logging/logger';
import { GiveUp } from '../../platform/queue/errors';
import type { JobDefinition } from '../../platform/queue/jobs';
import { markFailed, sentNote } from './sendings.jobs';

interface Stored {
  kind: EventKind | null;
  occurred_at: Date | null;
  provider_ref: string | null;
  sending_id: string | null;
}
interface Line {
  id: string;
  case_id: string;
  status: 'QUEUED' | 'UNCERTAIN' | 'SENT' | 'FAILED';
  failure: string | null;
  level: number | null;
  simulated: boolean;
  provider_ref: string | null;
  created_at: Date;
  confirmed_at: Date | null;
  delivered_at: Date | null;
  undelivered_at: Date | null;
  undelivered_reason: string | null;
  complained_at: Date | null;
}
type Tone = 'danger' | 'warning' | 'success';

/** Events that prove the message has left the hands of Resend, whatever became of it afterwards. */
const LEFT: ReadonlySet<EventKind> = new Set(['SENT', 'DELIVERED', 'DELAYED', 'BOUNCED', 'BOUNCED_SOFT', 'COMPLAINED']);
/** Why a message did not reach its address, by event, and what the history of the case says of it. */
const UNDELIVERED: Partial<Record<EventKind, { reason: string; detail: string }>> = {
  BOUNCED: { reason: 'HARD_BOUNCE', detail: 'adresse rejetée' },
  BOUNCED_SOFT: { reason: 'BOUNCE', detail: 'rejet temporaire' },
  SUPPRESSED: { reason: 'SUPPRESSED', detail: 'adresse écartée par Resend' },
  FAILED: { reason: 'PROVIDER_FAILED', detail: 'échec chez Resend' },
};
/** After which the address is no longer written to (question 224). */
const UNREACHABLE: ReadonlySet<EventKind> = new Set(['BOUNCED', 'SUPPRESSED', 'COMPLAINED']);
/** Reasons that leave the address alone, and those that condemn it: the first may become the second, never the reverse. */
const MILD: readonly string[] = ['BOUNCE', 'PROVIDER_FAILED'];
const FINAL: readonly string[] = ['HARD_BOUNCE', 'SUPPRESSED'];
/**
 * The failures that Resend itself reported, of a message it had taken: the only failed lines it may speak of again. One
 * that failed before it was taken, or that Resend refused at the call, has no message there.
 */
const REPORTED: readonly string[] = ['PROVIDER_FAILED', 'PROVIDER_SUPPRESSED'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const note = (tx: Transaction, caseId: string, kind: string, title: string, detail: string, tone: Tone) =>
  tx.$executeRaw`SELECT app.add_case_event(${caseId}::uuid, ${kind}, ${title}, ${detail}, ${tone}::event_tone, false) WHERE app.case_writable(${caseId}::uuid)`;

/**
 * What an event changes, in one transaction with the event itself: the event and the line are held until the end, so that
 * two events of the same message, or an event and the task that sent it, pass one after the other. False: nothing to do
 * with it (a line of another environment, a simulated one, one that has not been taken, failed before it was or was
 * refused by Resend at the call, a message that is not the one of the line): said in the logs, without a name.
 *
 * - A line whose fate was unknown (`UNCERTAIN`) is settled: sent, on the date of the event, when the event proves that the
 *   message has left; failed when Resend says that it has not.
 * - A line already settled keeps its status for ever (`keep_sending`). One that had failed and yet has left is said so, to
 *   the history and to the logs, and counts as left for the caps and the levels (`confirmed_at`): nothing is sent twice in
 *   its name.
 * - Delivery, bounce and complaint are written once each on the line and in the history of the case. An address that can
 *   no longer be written to is marked as wrong (`app.invalidate_unreachable_contact`). One fact may be made worse: a
 *   temporary bounce, or a failure at Resend, followed by a permanent bounce or a suppression, takes that reason.
 */
export async function applyResendEvent(tx: Transaction, event: Stored, logger: AppLogger, now: Date): Promise<boolean> {
  const { kind } = event;
  if (!kind || kind === 'OTHER') return false;
  // By the line the message names; without a name (a message older than the tag), by the message itself. A name that is
  // not known here is of another environment: never looked for otherwise.
  const [line] = await tx.$queryRaw<Line[]>`
    SELECT s.id, s.case_id, s.status::text AS status, s.failure, s.level, s.simulated, s.provider_ref, s.created_at, s.confirmed_at, s.delivered_at,
      s.undelivered_at, s.undelivered_reason, s.complained_at
    FROM sendings s
    WHERE s.channel = 'EMAIL' AND CASE WHEN ${event.sending_id}::uuid IS NOT NULL THEN s.id = ${event.sending_id}::uuid
      ELSE ${event.provider_ref}::text IS NOT NULL AND s.provider_ref = ${event.provider_ref}::text END
    ORDER BY s.created_at LIMIT 1 FOR UPDATE OF s`;
  if (!line) return false;
  if (
    // Never given to Resend: simulated, not taken yet, failed before it was taken, or refused by Resend at the call.
    line.simulated ||
    line.status === 'QUEUED' ||
    (line.status === 'FAILED' && !REPORTED.includes(line.failure ?? '')) ||
    // The line knows its message: an event about another one says nothing of it.
    (line.provider_ref && UUID.test(line.provider_ref) && event.provider_ref && line.provider_ref !== event.provider_ref)
  ) {
    // Another message under the name of one of ours: a copy of this database writing with the key of this team?
    logger.warn({ kind: 'resend' }, 'resend event about another message');
    return false;
  }
  const { id, case_id: caseId } = line;
  const about = `E-mail · niveau ${line.level ?? 1}`;
  // The date of Resend, between the request and now: never before the line existed, never ahead of this clock.
  const at = new Date(Math.min(now.getTime(), Math.max(line.created_at.getTime(), (event.occurred_at ?? now).getTime())));
  const left = LEFT.has(kind);
  let acted = false;

  if (line.status === 'UNCERTAIN') {
    if (left) {
      await tx.sending.updateMany({
        where: { id, status: 'UNCERTAIN' },
        data: { status: 'SENT', sentAt: at, confirmedAt: at, ...(event.provider_ref ? { providerRef: event.provider_ref } : {}) },
      });
      // Whoever settles the line says so: the task that sent it finds it settled and writes nothing.
      await sentNote(caseId, line.level)(tx);
    } else {
      // Resend itself says that nothing has left: the colleague is told, and may ask again.
      await markFailed((work) => work(tx), id, caseId, kind === 'SUPPRESSED' ? 'PROVIDER_SUPPRESSED' : 'PROVIDER_FAILED', 'UNCERTAIN');
    }
    acted = true;
  } else if (left && !line.confirmed_at) {
    await tx.sending.updateMany({ where: { id, confirmedAt: null }, data: { confirmedAt: at } });
    if (line.status === 'FAILED') {
      // The line said « not sent », the colleague was told so, and the message has left all the same.
      await note(tx, caseId, 'REMINDER_SENT', 'Relance partie malgré un échec signalé', about, 'warning');
      logger.error({ kind: 'resend' }, 'sending failed yet confirmed by the provider');
    }
    acted = true;
  }

  let fact = false;
  const undelivered = UNDELIVERED[kind];
  if (kind === 'DELIVERED' && !line.delivered_at) {
    await tx.sending.updateMany({ where: { id, deliveredAt: null }, data: { deliveredAt: at } });
    await note(tx, caseId, 'REMINDER_DELIVERED', 'Relance distribuée', about, 'success');
    fact = true;
  } else if (kind === 'COMPLAINED' && !line.complained_at) {
    await tx.sending.updateMany({ where: { id, complainedAt: null }, data: { complainedAt: at } });
    await note(tx, caseId, 'REMINDER_COMPLAINT', 'Relance signalée comme indésirable', about, 'danger');
    fact = true;
  } else if (undelivered && !line.undelivered_at && (left || line.status !== 'FAILED')) {
    // A line that had already failed learns nothing from Resend saying that nothing has left.
    await tx.sending.updateMany({ where: { id, undeliveredAt: null }, data: { undeliveredAt: at, undeliveredReason: undelivered.reason } });
    // « Relance non envoyée » has just been written for a line that was uncertain.
    if (left || line.status === 'SENT') await note(tx, caseId, 'REMINDER_UNDELIVERED', 'Relance non distribuée', `${about} · ${undelivered.detail}`, 'danger');
    fact = true;
  } else if (undelivered && FINAL.includes(undelivered.reason) && line.undelivered_reason !== null && MILD.includes(line.undelivered_reason)) {
    // The same message, first bounced for a time or failed at Resend, then refused for good: the reason alone changes, on
    // the date already written. The history has said once that the reminder did not arrive; what follows says the rest.
    const { count } = await tx.sending.updateMany({ where: { id, undeliveredReason: { in: [...MILD] } }, data: { undeliveredReason: undelivered.reason } });
    fact = count === 1;
  }
  if (fact && UNREACHABLE.has(kind)) {
    const [marked] = await tx.$queryRaw<{ marked: boolean }[]>`SELECT app.invalidate_unreachable_contact(${id}::uuid) AS marked`;
    if (marked?.marked === true) {
      // Neither the address nor a name: what happened, and why.
      await note(
        tx,
        caseId,
        'CONTACT_INVALIDATED',
        'Adresse e-mail marquée invalide',
        kind === 'COMPLAINED' ? 'Signalement comme indésirable' : kind === 'SUPPRESSED' ? 'Adresse écartée par Resend' : 'Rebond Resend',
        'warning',
      );
      await tx.$executeRaw`SELECT app.log('CONTACT_CHANGED', 'case', ${caseId}::uuid, '{}'::jsonb)`;
    }
  }
  return acted || fact;
}

/**
 * The events of Resend that the API has written (`POST /hooks/resend`): each one is tied to its line of `sendings`, once.
 * Nothing leaves from here, and a second run finds the event handled: the task may be tried again.
 */
export function resendEventJobs({ logger, now = () => new Date() }: { logger: AppLogger; now?: () => Date }): Record<string, JobDefinition> {
  return {
    'resend-event': {
      // Written by the route of the provider, once the signature was checked: nobody had signed in.
      from: ['HOOK'],
      repeatable: true,
      run: async ({ payload, authorize }) => {
        const eventId = payload.event;
        if (typeof eventId !== 'string') throw new GiveUp('NO_IDENTIFIER');
        const asApplication = await authorize(() => Promise.resolve(false));
        await asApplication(async (tx) => {
          const [event] = await tx.$queryRaw<Stored[]>`
            SELECT kind, occurred_at, provider_ref::text AS provider_ref, sending_id::text AS sending_id FROM webhook_events
            WHERE id = ${eventId}::uuid AND provider = ${PROVIDER} AND status = 'RECEIVED' FOR UPDATE`;
          if (!event) return;
          const done = await applyResendEvent(tx, event, logger, now());
          await tx.$executeRaw`
            UPDATE webhook_events SET status = ${done ? 'PROCESSED' : 'IGNORED'}::webhook_status, processed_at = now() WHERE id = ${eventId}::uuid`;
        });
      },
    },
  };
}
