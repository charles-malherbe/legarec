import { formatCents } from '@legarec/contracts';
import type { Transaction } from '../platform/database/database';
import { dayOf } from '../platform/format';
import { GiveUp } from '../platform/queue/errors';
import type { JobDefinition } from '../platform/queue/jobs';
import { lateDays } from '../modules/creditors/late';
import { SettingValues } from '../modules/settings/values';
import type { Vault } from '../modules/vault/vault';
import { minimize, refusedByGuard } from './guards';
import { CASE_SUMMARY_SYSTEM, CASE_SUMMARY_VERSION, caseSummaryInput, caseSummaryOutput, type CaseFacts } from './prompts/case-summary';
import { costOf, type AiSetup } from './provider';

const MAX_TOKENS = 800;
const short = (day: Date) => `${dayOf(day).slice(8, 10)}/${dayOf(day).slice(5, 7)}`;
/** Paramètres › Assistant IA: whether a feature is on, and the budget of the month in millionths of a euro. */
export function aiSettings(values: SettingValues, feature: string): { on: boolean; budgetMicro: number } {
  const fields = values.section('firm', 'ia')?.blocks.flatMap((block) => block.fields) ?? [];
  const on = fields.find((field) => field.id === feature)?.checked;
  const typed = values
    .text('firm', 'ia', 'budget')
    .replace(/[\s\u00a0\u202f€]/gu, '')
    .replace(',', '.');
  const euros = Number.parseFloat(typed);
  return { on: on === true, budgetMicro: Number.isFinite(euros) && euros >= 0 ? Math.round(euros * 1_000_000) : 0 };
}

/** What the case says, read with the rights of the colleague who asked. */
/** The details of these events are made by the application (amounts, dates, channels); the others are free text: title only. */
const DETAILED = /^(PLAN|PAYMENT|REMINDER|RECEIPT)_/u;

async function factsOf(tx: Transaction, id: string): Promise<{ facts: CaseFacts; creditorId: string; events: number; known: string[] } | null> {
  const row = await tx.case.findFirst({
    where: { id },
    select: {
      reference: true,
      status: true,
      creditorId: true,
      depositedName: true,
      contactName: true,
      debtorAddress: true,
      debtor: { select: { kind: true, name: true } },
      contacts: { select: { value: true } },
      invoices: { select: { number: true, dueOn: true, principalCents: true, principalPaidCents: true } },
      plans: { where: { status: 'ACTIVE' }, take: 1, select: { months: true, totalCents: true } },
      events: { orderBy: { occurredAt: 'desc' }, take: 25, select: { kind: true, occurredAt: true, title: true, detail: true } },
      _count: { select: { events: true } },
    },
  });
  if (!row) return null;
  const open = row.invoices.filter((invoice) => invoice.principalPaidCents < invoice.principalCents);
  const oldest = open.reduce<Date | null>((min, invoice) => (!min || invoice.dueOn < min ? invoice.dueOn : min), null);
  const plan = row.plans[0];
  const known = [row.debtor.name, row.depositedName, row.contactName, row.debtorAddress, ...row.contacts.map((contact) => contact.value)].filter(
    (value): value is string => !!value,
  );
  return {
    creditorId: row.creditorId,
    events: row._count.events,
    known,
    facts: {
      reference: row.reference,
      status: row.status,
      debtorKind: row.debtor.kind === 'INDIVIDUAL' ? 'particulier' : 'professionnel',
      outstanding: formatCents(open.reduce((sum, invoice) => sum + invoice.principalCents - invoice.principalPaidCents, 0)),
      daysLate: lateDays(oldest, dayOf(new Date())),
      invoices: open.map((invoice) => ({
        number: invoice.number,
        dueOn: short(invoice.dueOn),
        left: formatCents(invoice.principalCents - invoice.principalPaidCents),
      })),
      plan: plan ? `${plan.months} mensualités, ${formatCents(plan.totalCents)}` : null,
      events: row.events.map((event) => ({
        on: short(event.occurredAt),
        title: event.title,
        detail: event.detail && DETAILED.test(event.kind) ? minimize(event.detail, known).slice(0, 200) : null,
      })),
    },
  };
}

/**
 * The summary of a case (docs/ia.md): asked by a colleague who acts on it, written in the journal whatever happens, shown
 * marked « Proposé par l'IA ». Never applied to anything: it is read, accepted, ignored or reported.
 */
export const aiJobs = (setup: () => AiSetup | null, vault: Pick<Vault, 'open'>): Record<string, JobDefinition> => ({
  'case-summary': {
    from: ['STAFF'],
    // A single try: a second one would be billed again, and the first one might already be.
    repeatable: false,
    run: async ({ payload, asAuthor, authorize }) => {
      const id = String(payload.case);
      const ai = setup();
      if (!ai) throw new GiveUp('AI_OFF');
      const asApplication = await authorize(
        async (tx) => (await tx.$queryRaw<{ ok: boolean }[]>`SELECT app.can_act_on_case(officer_id) AS ok FROM cases WHERE id = ${id}::uuid`)[0]?.ok === true,
      );
      await summarize({ ai, vault, id, author: String(payload.by ?? '') || null, read: asAuthor, asApplication });
    },
  },
  // Queued by the application when something new has happened on a case (sweepCaseEvents): nobody asked, nobody acts.
  'case-summary-event': {
    from: ['SYSTEM'],
    repeatable: false,
    run: async ({ payload, authorize }) => {
      const id = String(payload.case);
      const ai = setup();
      if (!ai) throw new GiveUp('AI_OFF');
      // No author: the rights of the application, which reads every case; the same facts and the same masks.
      const asApplication = await authorize(() => Promise.resolve(true));
      await summarize({ ai, vault, id, author: null, read: asApplication, asApplication });
    },
  },
});

type Run = <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>;

/** One summary: read, cached, checked against the budget, asked, checked against the guards, written in the journal. */
async function summarize({
  ai,
  vault,
  id,
  author,
  read: readWith,
  asApplication,
}: {
  ai: AiSetup;
  vault: Pick<Vault, 'open'>;
  id: string;
  author: string | null;
  read: Run;
  asApplication: Run;
}): Promise<void> {
  const read = await readWith((tx) => factsOf(tx, id));
  if (!read) throw new GiveUp('UNKNOWN_CASE');
  // Nothing new since the last summary still shown: no call (the cache of docs/ia.md).
  const last = await asApplication((tx) =>
    tx.aiSuggestion.findFirst({
      where: { caseId: id, feature: 'CASE_SUMMARY', outcome: 'SUGGESTED' },
      orderBy: { createdAt: 'desc' },
      select: { events: true, decision: true },
    }),
  );
  if (last && last.decision !== 'REPORTED' && last.events === read.events) return;
  const user = minimize(caseSummaryInput(read.facts), read.known);
  const summary = `${read.facts.invoices.length} factures, ${read.facts.events.length} événements, ${user.length} caractères`;
  let budgetMicro = 0;
  const record = (data: {
    outcome: 'SUGGESTED' | 'REFUSED_BY_GUARD' | 'FAILED' | 'OVER_BUDGET';
    output?: object;
    inputTokens?: number;
    outputTokens?: number;
    costMicro?: number;
  }) =>
    asApplication(async (tx) => {
      await tx.aiSuggestion.create({
        data: {
          feature: 'CASE_SUMMARY',
          caseId: id,
          creditorId: read.creditorId,
          inputSummary: summary,
          model: ai.advanced,
          promptVersion: CASE_SUMMARY_VERSION,
          events: read.events,
          askedBy: author,
          outcome: data.outcome,
          output: data.output,
          inputTokens: data.inputTokens ?? 0,
          outputTokens: data.outputTokens ?? 0,
          costMicro: BigInt(data.costMicro ?? 0),
        },
        select: { id: true },
      });
      // At 80 % of the budget, the Director is told, once a month.
      await tx.$executeRaw`SELECT app.ai_budget_alert(${BigInt(budgetMicro)}::bigint)`;
    });
  const state = await asApplication(async (tx) => {
    const values = await SettingValues.read(tx);
    const [spent] = await tx.$queryRaw<{ micro: bigint }[]>`SELECT app.ai_spent() AS micro`;
    const [key] = await tx.$queryRaw<{ id: string | null; value_cipher: Uint8Array | null }[]>`SELECT * FROM app.ai_key()`;
    return { settings: aiSettings(values, 'ia4'), spent: Number(spent?.micro ?? 0n), key };
  });
  if (!state.settings.on) throw new GiveUp('AI_FEATURE_OFF');
  budgetMicro = state.settings.budgetMicro;
  // The budget is checked before the call (docs/ia.md): over it, nothing leaves until next month.
  if (state.spent >= state.settings.budgetMicro) {
    await record({ outcome: 'OVER_BUDGET' });
    return;
  }
  if (!state.key?.id || !state.key.value_cipher) throw new GiveUp('NO_KEY');
  const key = vault.open(state.key.id, state.key.value_cipher);
  let completion;
  try {
    completion = await ai.provider.complete({ model: ai.advanced, system: CASE_SUMMARY_SYSTEM, user, maxTokens: MAX_TOKENS }, key);
  } catch {
    // The provider may have billed it all the same: counted at the most it could cost.
    const estimate = { inputTokens: Math.ceil((CASE_SUMMARY_SYSTEM.length + user.length) / 3), outputTokens: MAX_TOKENS };
    await record({ outcome: 'FAILED', ...estimate, costMicro: costOf(ai.price, { text: '', ...estimate }) });
    return;
  }
  const cost = { inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, costMicro: costOf(ai.price, completion) };
  let parsed;
  try {
    parsed = caseSummaryOutput.safeParse(JSON.parse(completion.text));
  } catch {
    parsed = null;
  }
  if (!parsed?.success) {
    await record({ outcome: 'FAILED', ...cost });
    return;
  }
  if (refusedByGuard(parsed.data.lines.map((line) => line.v))) {
    await record({ outcome: 'REFUSED_BY_GUARD', ...cost });
    return;
  }
  await record({ outcome: 'SUGGESTED', output: parsed.data, ...cost });
}

/** Quiet for this long after its last event, a case is summarised: a burst of events makes a single call. */
const QUIET_MINUTES = 5;
/** Older than this, an event no longer asks for a summary. */
const RECENT_HOURS = 24;
const AT_ONCE = 20;

/**
 * Run by the clock in the queue `ai` (docs/ia.md, « Nouvel événement sur le dossier »): queues a summary for each open
 * case where something has happened since its last summary, once nothing more has happened for a few minutes. Nothing is
 * queued when the AI is off, the feature switched off or the budget of the month spent; a summary is only ever shown,
 * never applied. Returns how many were queued.
 */
export async function sweepCaseEvents(setup: () => AiSetup | null, run: Run): Promise<number> {
  if (!setup()) return 0;
  return run(async (tx) => {
    // Two workers at once queue nothing twice.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('ai-case-events', 0))`;
    const settings = aiSettings(await SettingValues.read(tx), 'ia4');
    if (!settings.on) return 0;
    const [spent] = await tx.$queryRaw<{ micro: bigint }[]>`SELECT app.ai_spent() AS micro`;
    if (Number(spent?.micro ?? 0n) >= settings.budgetMicro) return 0;
    const due = await tx.$queryRaw<{ id: string; events: number }[]>`
      SELECT r.case_id::text AS id, r.events
      FROM (
        SELECT e.case_id, count(*)::integer AS events, max(e.occurred_at) AS last
        FROM case_events e
        WHERE e.case_id IN (SELECT DISTINCT case_id FROM case_events WHERE occurred_at > now() - make_interval(hours => ${RECENT_HOURS}))
        GROUP BY e.case_id
      ) r
      JOIN cases c ON c.id = r.case_id
      WHERE r.last <= now() - make_interval(mins => ${QUIET_MINUTES})
        AND c.closed_on IS NULL AND c.anonymized_at IS NULL
        AND r.events IS DISTINCT FROM (
          SELECT s.events FROM ai_suggestions s WHERE s.case_id = r.case_id AND s.feature = 'CASE_SUMMARY' ORDER BY s.created_at DESC LIMIT 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM outbox o
          WHERE o.queue = 'ai' AND o.name = 'case-summary-event' AND o.payload ->> 'case' = r.case_id::text AND o.payload ->> 'events' = r.events::text
        )
      ORDER BY r.last
      LIMIT ${AT_ONCE}`;
    // Once for each state of the case, even when its task ends without a word in the journal.
    for (const { id, events } of due)
      await tx.$queryRaw`SELECT app.enqueue('ai', 'case-summary-event', ${JSON.stringify({ case: id, events })}::jsonb, NULL, NULL::timestamptz)`;
    return due.length;
  });
}
