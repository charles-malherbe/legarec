import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, seed, type Seed, type TestDatabase } from '../../../test/database';
import { Database } from '../database/database';
import { AUDIT_ACTIONS, auditSentence } from './actions';
import { Audit, type AuditEntry } from './audit';

let test: TestDatabase;
let s: Seed;
let api: Database;
beforeAll(async () => {
  test = await createTestDatabase();
  s = await seed(test.admin);
  api = new Database(test.url('app'));
});
afterAll(async () => {
  await api.close();
  await test.drop();
});

const log = (params: AuditEntry['params'], entity?: AuditEntry['entity']) =>
  api.run({ kind: 'staff', userId: s.director, role: 'DIRECTOR', delegations: [] }, () => new Audit(api).log({ action: 'SECRET_SAVED', entity, params }));
const last = async () =>
  (
    await test.admin.query<{ params: unknown; entity_type: string; entity_id: string }>(
      'SELECT params, entity_type, entity_id FROM audit_log ORDER BY occurred_at DESC LIMIT 1',
    )
  ).rows[0]!;

describe('details of a line of the audit log', () => {
  it.each<[string, AuditEntry['params']]>([
    ['nothing', {}],
    ['an identifier', { caseId: '01a2125f-3eeb-7d5a-a7da-e46706b4e5a8' }],
    ['a date', { from: '2026-11-25' }],
    ['a role', { role: 'COLLECTION_MANAGER' }],
    ['a technical name', { secret: 'RESEND_API_KEY' }],
    ['a short number', { months: 8, count: 999 }],
    ['yes or no', { active: true }],
  ])('may hold %s', async (_what, params) => {
    await log(params);
    expect((await last()).params).toEqual(params);
  });

  it.each<[string, unknown]>([
    ['an e-mail address', { to: 'jean.martin@exemple.test' }],
    ['the reference of a case', { reference: 'LGR-2026-00001' }],
    ['a SIREN', { siren: '800000001' }],
    ['a SIREN as a number', { siren: 800000001 }],
    ['a spaced SIREN', { siren: '800 000 001' }],
    ['a SIRET', { siret: '80000000100012' }],
    ['a mobile number', { phone: '0612345678' }],
    ['an international number', { phone: '+33612345678' }],
    ['a spaced number', { phone: '06 12 34 56 78' }],
    ['an IBAN', { iban: 'FR7630006000011234567890189' }],
    ['an access code', { code: 'KXPM' }],
    ['a name in capitals', { who: 'DUPONT' }],
    ['a name', { who: 'Jean Martin' }],
    ['an amount', { cents: 125000 }],
    ['a six-digit code', { code: 123456 }],
    ['a decimal', { rate: 12.5 }],
    ['a sentence', { text: 'Message envoyé' }],
    ['an object', { inside: { who: 'x' } }],
    ['a list', { list: ['x'] }],
    ['nothing at all', { empty: null }],
    ['an address as the name of a field', { 'jean@exemple.test': true }],
  ])('never holds %s', async (_what, params) => {
    await expect(log(params as AuditEntry['params'])).rejects.toThrow(/audit_log_params_check/u);
  });

  it('carries the entity by its number', async () => {
    await log({}, { type: 'case', id: s.cases.ofA });
    expect(await last()).toEqual({ params: {}, entity_type: 'case', entity_id: s.cases.ofA });
  });
});

describe('sentence shown', () => {
  it('comes from the catalogue, filled with the details', () => {
    expect(auditSentence('PLAN_APPROVED', { months: 8 })).toBe('Échéancier de 8 mois validé');
    expect(auditSentence('SECRET_SAVED', { secret: 'RESEND_API_KEY' })).toBe('Secret enregistré : RESEND_API_KEY');
    expect(auditSentence('UNKNOWN_ACTION', {})).toBe('UNKNOWN_ACTION');
  });
  it('exists for every action, under a name PostgreSQL accepts', () => {
    for (const [action, sentence] of Object.entries(AUDIT_ACTIONS)) {
      expect(action).toMatch(/^[A-Z][A-Z0-9_]{2,63}$/u);
      expect(sentence.length).toBeGreaterThan(3);
    }
  });
});
