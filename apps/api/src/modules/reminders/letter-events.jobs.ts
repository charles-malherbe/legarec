import type { LetterTrack, LetterUndelivered, MySendingBoxClient } from '../../letters/mysendingbox';
import type { Transaction } from '../../platform/database/database';
import type { AppLogger } from '../../platform/logging/logger';
import { GiveUp } from '../../platform/queue/errors';
import type { JobDefinition, Run } from '../../platform/queue/jobs';
import { trackOf } from '../../letters/mysendingbox';
import type { Vault } from '../vault/vault';
import { detailOf } from './sendings.jobs';

interface Line {
  id: string;
  case_id: string;
  channel: string;
  template: string;
  created_at: Date;
  confirmed_at: Date | null;
  delivered_at: Date | null;
  undelivered_at: Date | null;
}
/** What the history says of a letter that did not arrive. */
const WHY: Record<LetterUndelivered, string> = {
  RETURNED: 'retourné à l’expéditeur',
  WRONG_ADDRESS: 'adresse erronée',
  LOST: 'perdu par La Poste',
  CANCELED: 'annulé chez MySendingBox',
  PROVIDER_FAILED: 'échec chez MySendingBox',
};
/** How long a letter is followed: far beyond the fifteen days La Poste keeps a registered letter at the counter. */
const FOLLOWED_DAYS = 60;
/** Letters asked again by each run of the clock: a few seconds of calls. */
const BATCH = 50;

export interface LetterTracking {
  vault: Vault;
  mysendingbox: Pick<MySendingBoxClient, 'read'>;
  /** `MYSENDINGBOX_ENV=production`: only live letters, with the live key; otherwise only test ones, with the test key. */
  real: boolean;
  logger: AppLogger;
  now?: () => Date;
}

const note = (tx: Transaction, caseId: string, kind: string, title: string, detail: string, tone: 'success' | 'danger') =>
  tx.$executeRaw`SELECT app.add_case_event(${caseId}::uuid, ${kind}, ${title}, ${detail}, ${tone}::event_tone, false) WHERE app.case_writable(${caseId}::uuid)`;

/** Each fact once, on the line and in the history of the case; a fact already written never changes. True when one was. */
async function apply(tx: Transaction, line: Line, track: LetterTrack, now: Date): Promise<boolean> {
  // The date of MySendingBox, between the request and now.
  const within = (at: Date) => new Date(Math.min(now.getTime(), Math.max(line.created_at.getTime(), at.getTime())));
  const about = detailOf({ channel: line.channel, template: line.template, level: null });
  let changed = false;
  if (track.posted && !line.confirmed_at) {
    await tx.sending.updateMany({ where: { id: line.id, confirmedAt: null }, data: { confirmedAt: within(track.posted) } });
    changed = true;
  }
  if (track.delivered && !line.delivered_at) {
    await tx.sending.updateMany({ where: { id: line.id, deliveredAt: null }, data: { deliveredAt: within(track.delivered) } });
    await note(tx, line.case_id, 'REMINDER_DELIVERED', 'Courrier distribué', about, 'success');
    changed = true;
  } else if (track.undelivered && !line.undelivered_at && !line.delivered_at) {
    const { at, reason } = track.undelivered;
    await tx.sending.updateMany({ where: { id: line.id, undeliveredAt: null }, data: { undeliveredAt: within(at), undeliveredReason: reason } });
    await note(tx, line.case_id, 'REMINDER_UNDELIVERED', 'Courrier non distribué', `${about} · ${WHY[reason]}`, 'danger');
    changed = true;
  }
  return changed;
}

/**
 * Asks MySendingBox what became of a letter of ours, and writes it. Only a letter this database sent for real (`SENT`,
 * neither simulated nor of the other mode) is followed. The call is made outside any transaction; the line is then held
 * while what it says is written.
 */
export async function refreshLetter(asApplication: Run, parts: LetterTracking, sending: string): Promise<boolean> {
  const { vault, mysendingbox, real, logger, now = () => new Date() } = parts;
  const known = await asApplication(async (tx) => {
    const [line] = await tx.$queryRaw<{ id: string; provider_ref: string }[]>`
      SELECT id, provider_ref FROM sendings
      WHERE id = ${sending}::uuid AND channel IN ('REGISTERED_LETTER', 'LETTER') AND status = 'SENT' AND NOT simulated AND provider_ref IS NOT NULL`;
    if (!line) return null;
    const name = real ? 'MYSENDINGBOX_API_KEY' : 'MYSENDINGBOX_TEST_API_KEY';
    const [stored] = await tx.$queryRaw<{ id: string | null; value_cipher: Uint8Array | null }[]>`SELECT * FROM app.service_key(${name})`;
    return { id: line.id, ref: line.provider_ref, key: stored?.id && stored.value_cipher ? vault.open(stored.id, stored.value_cipher) : null };
  });
  if (!known?.key) return false;
  const letter = await mysendingbox.read(known.key, known.ref);
  if (!letter) return false;
  if (letter.live !== real) {
    // A letter of the other mode under one of our names: a copy of this database writing with the key of the firm?
    logger.warn({ kind: 'mysendingbox' }, 'letter of another mode');
    return false;
  }
  const track = trackOf(letter.events);
  return asApplication(async (tx) => {
    const [line] = await tx.$queryRaw<Line[]>`
      SELECT id, case_id, channel::text AS channel, template, created_at, confirmed_at, delivered_at, undelivered_at
      FROM sendings WHERE id = ${known.id}::uuid AND status = 'SENT' FOR UPDATE`;
    return line ? apply(tx, line, track, now()) : false;
  });
}

/**
 * The letters still on their way, asked again by the clock: a webhook may be lost, and MySendingBox gives up after eight.
 * Sent for real less than 60 days ago, neither delivered nor returned; those asked the longest ago first, 50 at most.
 */
export async function sweepLetters(asApplication: Run, parts: LetterTracking): Promise<number> {
  const due = await asApplication((tx) =>
    tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM sendings
      WHERE channel IN ('REGISTERED_LETTER', 'LETTER') AND status = 'SENT' AND NOT simulated AND provider_ref IS NOT NULL
        AND delivered_at IS NULL AND undelivered_at IS NULL AND created_at > now() - make_interval(days => ${FOLLOWED_DAYS}::int)
      ORDER BY coalesce(confirmed_at, created_at), id LIMIT ${BATCH}`,
  );
  let changed = 0;
  for (const { id } of due) {
    try {
      if (await refreshLetter(asApplication, parts, id)) changed += 1;
    } catch (error) {
      // One letter that cannot be read now does not stop the others; the next run asks again.
      parts.logger.warn({ kind: 'mysendingbox', errorType: (error as Error).name }, 'letter not read');
    }
  }
  return changed;
}

/** A webhook named a letter: MySendingBox is asked about it. Harmless when run again. */
export function letterEventJobs(parts: LetterTracking): Record<string, JobDefinition> {
  return {
    'letter-refresh': {
      from: ['HOOK'],
      repeatable: true,
      run: async ({ payload, authorize }) => {
        const { sending } = payload;
        if (typeof sending !== 'string') throw new GiveUp('NO_IDENTIFIER');
        const asApplication = await authorize(() => Promise.resolve(false));
        await refreshLetter(asApplication, parts, sending);
      },
    },
  };
}
