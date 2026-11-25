import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../database/database';
import { Audit } from './audit';

function audit() {
  const written = vi.fn((_sql: TemplateStringsArray, ..._values: unknown[]) => Promise.resolve(1));
  return { written, audit: new Audit({ tx: { $executeRaw: written } } as unknown as Database) };
}

describe('summary of a line of the audit log', () => {
  it.each([
    'Échéancier validé',
    'Code d’accès régénéré',
    '3 dossiers confiés à un autre gestionnaire',
    'Facture FA-2026-0042 émise',
    'Rapport exporté : 1 250 lignes, du 01/11/2026 au 25/11/2026',
    'Durée des sessions : 30 minutes',
  ])('may say « %s »', async (summary) => {
    const { audit: target, written } = audit();
    await target.log({ action: 'PROBE', summary });
    expect(written).toHaveBeenCalledOnce();
    expect(written.mock.calls[0]!.slice(1)).toEqual(['PROBE', null, null, summary]);
  });

  it.each([
    ['an e-mail address', 'Message envoyé à jean.martin@exemple.test'],
    ['the reference of a case', 'Dossier LGR-2026-00001 modifié'],
    ['a SIREN', 'Entreprise 800000001 ajoutée'],
    ['a mobile number', 'Appel au 0612345678'],
    ['a spaced number', 'Appel au 06 12 34 56 78'],
    ['a dotted number', 'Appel au 06.12.34.56.78'],
    ['a dashed number', 'Appel au 06-12-34-56-78'],
    ['an IBAN', 'Virement depuis FR7630006000011234567890189'],
    ['a spaced IBAN', 'Virement depuis FR76 3000 6000 0112 3456 7890 189'],
    ['a foreign IBAN', 'Virement depuis DE89 3704 0044 0532 0130 00'],
  ])('never holds %s', async (_what, summary) => {
    const { audit: target, written } = audit();
    const refused = target.log({ action: 'PROBE', summary });
    await expect(refused).rejects.toThrow('Personal data in the audit summary of PROBE');
    // The error itself must not quote it: it ends in the log of the API.
    await refused.catch((error: Error) => expect(error.message).not.toContain(summary));
    expect(written).not.toHaveBeenCalled();
  });

  // Defect: `\b` before `+` never matches after a space, so the international form is let through.
  it.fails.each(['Appel au +33612345678', 'Appel au +33 6 12 34 56 78'])('never holds an international number: %s', async (summary) => {
    await expect(audit().audit.log({ action: 'PROBE', summary })).rejects.toThrow('Personal data');
  });
  // Defect: nine digits in a row only; a SIREN grouped by three and a SIRET, which begins with a SIREN, are let through.
  it.fails.each(['Entreprise 800 000 001 ajoutée', 'Établissement 80000000100012 ajouté', 'Établissement 800 000 001 00012 ajouté'])(
    'never holds a SIREN written otherwise: %s',
    async (summary) => {
      await expect(audit().audit.log({ action: 'PROBE', summary })).rejects.toThrow('Personal data');
    },
  );

  it('carries the entity by its number, as a parameter and never in the text of the query', async () => {
    const { audit: target, written } = audit();
    await target.log({ action: 'PROBE', entity: { type: 'case', id: '01a2125f-3eeb-7d5a-a7da-e46706b4e5a8' }, summary: 'Essai' });
    const [sql, ...values] = written.mock.calls[0]!;
    expect(values).toEqual(['PROBE', 'case', '01a2125f-3eeb-7d5a-a7da-e46706b4e5a8', 'Essai']);
    expect(sql.join('?')).toBe('SELECT app.log(?, ?, ?::uuid, ?)');
  });
});
