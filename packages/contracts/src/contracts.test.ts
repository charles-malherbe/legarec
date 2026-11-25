import { describe, expect, it } from 'vitest';
import {
  accessCode,
  allocatePayment,
  canAccessTechnicalSettings,
  canActOnCase,
  canReadCase,
  formatCents,
  isValidSiret,
  measureSms,
  parseCents,
  sirenOf,
  TCX_CODES,
} from './index';

describe('money', () => {
  it('formats and parses French amounts in cents', () => {
    expect(formatCents(4820000).replace(/[\u00a0\u202f]/g, ' ')).toBe('48 200 €');
    expect(formatCents(125050).replace(/[\u00a0\u202f]/g, ' ')).toBe('1 250,50 €');
    expect(parseCents('1 250,5 €')).toBe(125050);
    expect(parseCents('abc')).toBeNull();
  });
  it('applies a partial payment to interest first', () => {
    expect(allocatePayment(1500, { interest: 1000, principal: 9000, fees: 0 })).toEqual({ interest: 1000, principal: 500, fees: 0, remainder: 0 });
  });
});

describe('case access', () => {
  const actor = (role: Parameters<typeof canReadCase>[0]['role']) => ({ role, userId: 'me', activeDelegations: [] });
  const other = { officerId: 'x', officerRole: 'CLAIMS_OFFICER' as const };
  const free = { officerId: null, officerRole: null };
  const mine = { officerId: 'me', officerRole: 'DIRECTOR' as const };
  it('lets the Director read everything but act only on their own cases', () => {
    expect(canReadCase(actor('DIRECTOR'), other)).toBe(true);
    expect(canActOnCase(actor('DIRECTOR'), other)).toBe(false);
    expect(canActOnCase(actor('DIRECTOR'), mine)).toBe(true);
  });
  it('limits the other roles', () => {
    expect(canActOnCase(actor('COLLECTION_MANAGER'), other)).toBe(true);
    expect(canActOnCase(actor('COLLECTION_MANAGER'), free)).toBe(true);
    expect(canReadCase(actor('COLLECTION_MANAGER'), { officerId: 'd', officerRole: 'DIRECTOR' })).toBe(false);
    expect(canReadCase(actor('CLAIMS_OFFICER'), free)).toBe(false);
    expect(canReadCase(actor('DEVELOPER'), other)).toBe(false);
    expect(canAccessTechnicalSettings(actor('COLLECTION_MANAGER'))).toBe(false);
  });
});

describe('debtor access', () => {
  it('checks the SIRET key', () => {
    expect(isValidSiret('732 829 320 00074')).toBe(true);
    expect(isValidSiret('732 829 320 00075')).toBe(false);
    expect(sirenOf('732 829 320 00074')).toBe('732829320');
  });
  it('accepts lowercase codes and refuses I and O', () => {
    expect(accessCode.parse('kxpm')).toBe('KXPM');
    expect(accessCode.safeParse('KIPM').success).toBe(false);
  });
});

it('drops to 70 characters with ê, ç or a typographic apostrophe', () => {
  expect(measureSms("Bonjour, l'echeance du 05/12").limit).toBe(160);
  for (const char of ['ê', 'ç', '’', '«']) expect(measureSms(`a${char}`).limit).toBe(70);
  expect(measureSms('a'.repeat(161)).segments).toBe(2);
});

it('keeps the 3CX codes of the mockup', () => {
  expect(Object.values(TCX_CODES)).toEqual(['PROMESSE', 'ECHEANCIER', 'RAPPEL', 'LITIGE', 'DEJA_PAYE', 'ABSENT', 'NON_REPONSE', 'FAUX_NUMERO']);
});
