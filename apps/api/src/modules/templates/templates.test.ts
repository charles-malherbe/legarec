import { templateDetail, templatesData } from '@legarec/contracts';
import { sourceOf, TEMPLATE_CATALOGUE } from '@legarec/contracts/templateCatalogue';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';

let test: TestApp;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, `/staff/templates${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
const detail = async (as: string, id: string) => templateDetail.parse((await call(as, 'GET', `/${id}`)).body);
/** The source of the catalogue, its first words changed: what the checks accept. */
const SOURCE = () =>
  sourceOf(TEMPLATE_CATALOGUE.find((item) => item.id === 'demeure')!).replace('Madame, Monsieur,', 'Madame, Monsieur, nous revenons vers vous.');

beforeAll(async () => {
  test = await startApp();
});
afterAll(() => test.stop());

describe('templates', () => {
  it('are those of the catalogue until a version is published here', async () => {
    const list = templatesData.parse((await call('officerA', 'GET', '')).body);
    expect(list.items.map((item) => item.id)).toContain('amiable');
    expect(await detail('officerA', 'amiable')).toMatchObject({
      version: 1,
      status: 'PUBLISHED',
      pending: null,
      canImport: false,
      canValidate: false,
      author: 'Legarec',
    });
    expect((await call('officerA', 'GET', '/inconnu')).status).toBe(404);
  });

  it('a file is checked, submitted, then published by the Director: the version before is archived', async () => {
    expect((await call('officerA', 'POST', '/demeure/import', { source: SOURCE(), fileName: 'demeure.html' })).status).toBe(403);
    expect((await call('manager', 'POST', '/demeure/import', { source: SOURCE(), fileName: 'demeure.html' })).status).toBe(204);
    const imported = await detail('manager', 'demeure');
    expect(imported).toMatchObject({ status: 'IMPORTED', pending: { fileName: 'demeure.html', accepted: true } });
    expect(imported.pending?.previewHtml).not.toContain('{{');
    // Not before it is submitted, and not by the manager without the delegation.
    expect((await call('director', 'POST', '/demeure/review', { approved: true })).status).toBe(409);
    expect((await call('manager', 'POST', '/demeure/submit', { acknowledged: true })).status).toBe(204);
    expect((await call('manager', 'POST', '/demeure/import', { source: SOURCE(), fileName: 'autre.html' })).status).toBe(409);
    expect((await call('managerAlone', 'POST', '/demeure/review', { approved: true })).status).toBe(403);
    expect((await call('director', 'POST', '/demeure/review', { approved: true })).status).toBe(204);
    const published = await detail('officerA', 'demeure');
    expect(published).toMatchObject({ version: 2, status: 'PUBLISHED', pending: null, author: 'Remi Test' });
    expect(published.body).toContain('nous revenons vers vous');
    expect(published.versions.map((version) => [version.number, version.state])).toEqual([
      [2, 'PUBLISHED'],
      [1, 'ARCHIVED'],
    ]);
    expect(await rows("SELECT action FROM audit_log WHERE action IN ('TEMPLATE_IMPORTED', 'TEMPLATE_PUBLISHED') ORDER BY occurred_at")).toEqual([
      { action: 'TEMPLATE_IMPORTED' },
      { action: 'TEMPLATE_PUBLISHED' },
    ]);
    // The version of before comes back as a new one, validated as any other.
    expect((await call('manager', 'POST', '/demeure/restore', { version: 1 })).status).toBe(204);
    expect((await detail('manager', 'demeure')).status).toBe('RESTORED');
  });

  it('a file refused by the checks is never submitted; « Annuler », then « Annuler » again', async () => {
    expect((await call('director', 'POST', '/ferme/import', { source: '<p><script>alert(1)</script></p>', fileName: 'ferme.html' })).status).toBe(204);
    expect((await detail('director', 'ferme')).pending).toMatchObject({ accepted: false, previewHtml: '' });
    expect((await call('director', 'POST', '/ferme/submit', { acknowledged: true })).status).toBe(409);
    expect((await call('director', 'DELETE', '/ferme/import')).status).toBe(204);
    expect((await detail('director', 'ferme')).status).toBe('PUBLISHED');
    expect((await call('director', 'POST', '/ferme/import/undo')).status).toBe(204);
    expect((await detail('director', 'ferme')).status).toBe('IMPORTED');
    expect((await call('director', 'POST', '/ferme/import/undo')).status).toBe(404);
  });

  it('hides no markup in a comment, and keeps a long report short', async () => {
    const hidden = SOURCE().replace('</body>', '{{!-- <script>alert(1)</script><meta http-equiv="refresh" content="0"> --}}\n</body>');
    expect((await call('director', 'POST', '/attestation/import', { source: hidden, fileName: 'a.html' })).status).toBe(204);
    const seen = await detail('director', 'attestation');
    expect(seen.pending).toMatchObject({ accepted: false, previewHtml: '' });
    expect(seen.pending?.checks.some((check) => check.label.startsWith('Commentaire refusé'))).toBe(true);
    const many = SOURCE().replace('</body>', `${Array.from({ length: 300 }, (_, index) => `{{inconnu.champ${index}}}`).join(' ')}\n</body>`);
    expect((await call('director', 'POST', '/attestation/import', { source: many, fileName: 'b.html' })).status).toBe(204);
    const report = (await detail('director', 'attestation')).pending!;
    expect(report.accepted).toBe(false);
    expect(report.checks.length).toBeLessThanOrEqual(31);
    expect(report.checks.at(-1)?.label).toMatch(/^Et \d+ autres points$/u);
    expect(await rows("SELECT entity_type FROM audit_log WHERE action = 'TEMPLATE_IMPORTED' LIMIT 1")).toEqual([{ entity_type: 'template_version' }]);
  });

  it('refuses a file beyond 500 Ko', async () => {
    expect((await call('director', 'POST', '/amiable/import', { source: 'x'.repeat(500_001), fileName: 'gros.html' })).status).toBe(413);
  });

  it('keeps one version in force per template', async () => {
    expect(await rows("SELECT count(*)::int AS n FROM template_versions WHERE state = 'PUBLISHED'")).toEqual([{ n: 1 }]);
  });
});
