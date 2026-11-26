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
      const read = await asAuthor((tx) => factsOf(tx, id));
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
      const author = String(payload.by ?? '') || null;
      const record = (data: {
        outcome: 'SUGGESTED' | 'REFUSED_BY_GUARD' | 'FAILED' | 'OVER_BUDGET';
        output?: object;
        inputTokens?: number;
        outputTokens?: number;
        costMicro?: number;
      }) =>
        asApplication((tx) =>
          tx.aiSuggestion.create({
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
          }),
        );
      const state = await asApplication(async (tx) => {
        const values = await SettingValues.read(tx);
        const [spent] = await tx.$queryRaw<{ micro: bigint }[]>`SELECT app.ai_spent() AS micro`;
        const [key] = await tx.$queryRaw<{ id: string | null; value_cipher: Uint8Array | null }[]>`SELECT * FROM app.ai_key()`;
        return { settings: aiSettings(values, 'ia4'), spent: Number(spent?.micro ?? 0n), key };
      });
      if (!state.settings.on) throw new GiveUp('AI_FEATURE_OFF');
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
    },
  },
});
