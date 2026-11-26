import { caseDetail } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../test/app';
import { startMailWorker, type MailWorker } from '../../test/worker';
import { Vault } from '../modules/vault/vault';
import { aiSettings } from './ai.jobs';
import { minimize, refusedByGuard } from './guards';
import { CASE_SUMMARY_KEYS } from './prompts/case-summary';
import { aiSetup, SimulatedProvider, type CompletionRequest } from './provider';

const ON = {
  AI_ENABLED: 'true',
  IA_MODELE_RAPIDE: 'modele-rapide',
  IA_MODELE_AVANCE: 'modele-avance',
  AI_PROVIDER: 'simulated',
  AI_PRICE_INPUT: '1',
  AI_PRICE_OUTPUT: '2',
};
let test: TestApp;
let worker: MailWorker;
let caseId: string;
const asked: CompletionRequest[] = [];
let answer = (_request: CompletionRequest) => JSON.stringify({ lines: CASE_SUMMARY_KEYS.map((k) => ({ k, v: `${k} : 48 200 € dus, 68 jours de retard.` })) });
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string) =>
  test.call(method, `/staff${path}`, { as, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
const summary = async () => caseDetail.parse((await call('officerA', 'GET', `/cases/${caseId}`)).body).aiSummary;
const regenerate = async (as = 'officerA') => {
  const sent = await call(as, 'POST', `/cases/${caseId}/ai-summary`);
  if (sent.status === 204) await worker.run();
  return sent.status;
};

beforeAll(async () => {
  test = await startApp([], { env: ON });
  const provider = new SimulatedProvider((request) => (asked.push(request), answer(request)));
  worker = startMailWorker(test, { ai: aiSetup({ ...ON, NODE_ENV: 'test', AI_PRICE_INPUT: 1, AI_PRICE_OUTPUT: 2 } as never, provider)! });
  const [creditor] = await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('IA Delta') RETURNING id");
  const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('COMPANY', 'Bâtiplus Confidentiel') RETURNING id");
  [{ id: caseId }] = (await rows<{ id: string }>(
    "INSERT INTO cases (reference, creditor_id, debtor_id, officer_id) VALUES ('LGR-2026-77001', $1, $2, $3) RETURNING id",
    [creditor!.id, debtor!.id, test.s.officerA],
  )) as [{ id: string }];
  await rows(
    `INSERT INTO case_events (case_id, creditor_id, kind, title, detail, actor_kind, actor_id, actor_label)
     VALUES ($1, $2, 'NOTE', 'Appel', 'Virement promis depuis FR76 3000 6000 0112 3456 7890 189, joindre le 06 12 34 56 78', 'STAFF', $3, 'Hugo Benali')`,
    [caseId, creditor!.id, test.s.officerA],
  );
  const id = randomUUID();
  await rows("INSERT INTO vault_secrets (id, name, value_cipher) VALUES ($1, 'AI_API_KEY', $2)", [id, new Vault(test.config).seal(id, 'cle-de-test')]);
});
afterAll(async () => {
  await worker.stop();
  await test.stop();
});

describe('the guards of the assistant', () => {
  it('masks bank data and contact details, and refuses an answer that threatens or scores', () => {
    expect(minimize('IBAN FR76 3000 6000 0112 3456 7890 189 · carte 4970 1000 0000 0003 · jm@exemple.test · 06 12 34 56 78')).toBe(
      'IBAN [IBAN MASQUÉ] · carte [NUMÉRO MASQUÉ] · [ADRESSE MASQUÉE] · [TÉLÉPHONE MASQUÉ]',
    );
    expect(refusedByGuard(['Sans paiement, nous contacterons votre employeur.'])).toBe(true);
    expect(refusedByGuard(['Score de solvabilité faible.'])).toBe(true);
    expect(refusedByGuard(['Relancer par téléphone le 28/11.'])).toBe(false);
  });

  it('is off without every value, and never simulated in production', () => {
    expect(aiSetup({ ...ON, AI_PRICE_INPUT: 1, AI_PRICE_OUTPUT: 2, AI_ENABLED: undefined, NODE_ENV: 'test' } as never)).toBeNull();
    expect(aiSetup({ ...ON, AI_PRICE_INPUT: undefined, AI_PRICE_OUTPUT: 2, NODE_ENV: 'test' } as never)).toBeNull();
    expect(aiSetup({ ...ON, AI_PRICE_INPUT: 1, AI_PRICE_OUTPUT: 2, NODE_ENV: 'production' } as never)).toBeNull();
    expect(
      aiSetup({
        ...ON,
        AI_PROVIDER: 'openai-compatible',
        AI_BASE_URL: 'http://ia.exemple.test',
        AI_PRICE_INPUT: 1,
        AI_PRICE_OUTPUT: 2,
        NODE_ENV: 'test',
      } as never),
    ).toBeNull();
  });
});

describe('the summary of a case', () => {
  it('is asked by whoever acts on the case, sent without the name, the bank data nor the phone, and kept in the journal', async () => {
    expect(await regenerate('officerB')).toBe(404);
    expect(await regenerate('director')).toBe(403);
    expect(await regenerate()).toBe(204);
    const sent = asked.at(-1)!;
    expect(sent.model).toBe('modele-avance');
    expect(sent.user).not.toMatch(/Bâtiplus|FR76|06 12 34/u);
    expect(sent.user).toContain('[IBAN MASQUÉ]');
    expect((await summary())?.lines.map((line) => line.k)).toEqual([...CASE_SUMMARY_KEYS]);
    const [kept] = await rows<{ outcome: string; cost_micro: string; prompt_version: string }>(
      'SELECT outcome, cost_micro, prompt_version FROM ai_suggestions WHERE case_id = $1 ORDER BY created_at DESC LIMIT 1',
      [caseId],
    );
    expect(kept).toMatchObject({ outcome: 'SUGGESTED', prompt_version: 'synthese-dossier-v1' });
    expect(Number(kept!.cost_micro)).toBeGreaterThan(0);
  });

  it('keeps the previous one when an answer breaks a guard or is not the expected structure', async () => {
    const before = await summary();
    answer = () => JSON.stringify({ lines: CASE_SUMMARY_KEYS.map((k) => ({ k, v: 'Menacer de contacter la famille.' })) });
    await regenerate();
    answer = () => 'pas du JSON';
    await regenerate();
    expect(await summary()).toEqual(before);
    expect(
      (await rows<{ outcome: string }>('SELECT outcome FROM ai_suggestions WHERE case_id = $1 ORDER BY created_at', [caseId])).map((row) => row.outcome),
    ).toEqual(['SUGGESTED', 'REFUSED_BY_GUARD', 'FAILED']);
  });

  it('pauses over the budget of the month, without calling anyone', async () => {
    const calls = asked.length;
    await rows("INSERT INTO settings (key, value, updated_by) VALUES ('firm.ia.budget', '\"0 €\"', $1) ON CONFLICT (key) DO UPDATE SET value = '\"0 €\"'", [test.s.director]);
    await regenerate();
    expect(asked.length).toBe(calls);
    expect(
      (await rows<{ outcome: string }>('SELECT outcome FROM ai_suggestions WHERE case_id = $1 ORDER BY created_at DESC LIMIT 1', [caseId]))[0]?.outcome,
    ).toBe('OVER_BUDGET');
    await rows("DELETE FROM settings WHERE key = 'firm.ia.budget'");
  });

  it('is no longer shown once reported, and stays in the journal', async () => {
    expect((await call('officerA', 'POST', `/cases/${caseId}/ai-summary/report`)).status).toBe(204);
    expect(await summary()).toBeNull();
    expect(await rows("SELECT 1 FROM ai_suggestions WHERE case_id = $1 AND decision = 'REPORTED'", [caseId])).toHaveLength(1);
  });

  it('reads its switch and its budget in the settings', () => {
    const values = { section: () => ({ blocks: [{ fields: [{ id: 'ia4', checked: false }] }] }), text: () => '1 000,50 €' } as never;
    expect(aiSettings(values, 'ia4')).toEqual({ on: false, budgetMicro: 1_000_500_000 });
  });
});
