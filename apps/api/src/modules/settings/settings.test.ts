import { firmGroups, settingsHub, settingsSection, technicalGroups } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { Database } from '../../platform/database/database';
import { Vault } from '../vault/vault';
import { SettingValues } from './values';

/** Example IBAN of the international standard, not a real account. */
const IBAN = 'GB82 WEST 1234 5698 7654 32';
let test: TestApp;
let db: Database;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const get = (as: string, path: string) => test.call('GET', `/staff/settings/${path}`, { as });
const put = (as: string, path: string, body: unknown) =>
  test.call('PUT', `/staff/settings/${path}`, { as, body, headers: { 'idempotency-key': randomUUID() } });
const section = async (as: string, path: string) => settingsSection.parse((await get(as, path)).body);
const field = async (as: string, path: string, id: string) => (await section(as, path)).blocks.flatMap((block) => block.fields).find((item) => item.id === id)!;

beforeAll(async () => {
  test = await startApp();
  db = test.app.get(Database);
});
beforeEach(async () => {
  await rows('DELETE FROM settings');
  await rows(
    'INSERT INTO delegations (kind, granted_by) SELECT k, $1 FROM unnest(enum_range(NULL::delegation_kind)) k WHERE NOT EXISTS (SELECT 1 FROM delegations WHERE kind = k AND withdrawn_at IS NULL)',
    [test.s.director],
  );
});
afterAll(() => test.stop());

describe('the catalogue', () => {
  it('names each field once in its section, with keys that PostgreSQL accepts', () => {
    for (const [scope, groups] of [
      ['firm', firmGroups()],
      ['technical', technicalGroups()],
    ] as const)
      for (const item of groups.flatMap((group) => group.items)) {
        const ids = item.blocks.flatMap((block) => block.fields).map((one) => one.id);
        expect(new Set(ids).size, item.id).toBe(ids.length);
        for (const id of ids) expect(`${scope}.${item.id}.${id}`).toMatch(/^(firm|technical)\.[a-z]{2,32}\.[A-Za-z0-9-]{1,32}$/u);
      }
  });

  it('holds nothing of the demonstration', () => {
    const all = JSON.stringify([firmGroups(), technicalGroups()]);
    for (const demo of ['Camille', 'Dubreuil', '18 420', '6,40', '7 comptes', 'Connecté', 'il y a', '91.168']) {
      if (demo === 'Connecté') expect(all.replaceAll('Non connecté', '')).not.toContain(demo);
      else expect(all).not.toContain(demo);
    }
  });
});

describe('settings', () => {
  it('are those of the catalogue until they are changed', async () => {
    expect(await field('officerA', 'firm/relances', 'calls')).toMatchObject({ value: '2' });
    expect((await put('director', 'firm/relances', { calls: '3' })).status).toBe(204);
    expect(await field('officerA', 'firm/relances', 'calls')).toMatchObject({ value: '3' });
    expect((await put('manager', 'firm/regles', { r3: false })).status).toBe(204);
    expect(await field('officerA', 'firm/regles', 'r3')).toMatchObject({ checked: false });
    expect(settingsHub.parse((await get('director', 'firm')).body).canEdit).toBe(true);
  });

  it('come back to the catalogue when their value left the list', async () => {
    await rows("INSERT INTO settings (key, value, updated_by) VALUES ('firm.relances.calls', '\"99\"', $1), ('firm.regles.r2', 'false', $1)", [
      test.s.director,
    ]);
    expect(await field('director', 'firm/relances', 'calls')).toMatchObject({ value: '2' });
    // Locked by the rules of the firm, whatever is written.
    expect(await field('director', 'firm/regles', 'r2')).toMatchObject({ checked: true });
  });

  it.each([
    ['a value out of the list', 'firm/relances', { calls: '99' }],
    ['a text for a switch', 'firm/regles', { r3: 'non' }],
    ['a switch for a text', 'firm/cabinet', { name: true }],
    ['an empty name', 'firm/cabinet', { name: ' ' }],
    ['a wrong number', 'firm/cabinet', { phone: 'bientôt' }],
    ['a wrong IBAN', 'firm/cabinet', { iban: 'GB82 WEST 1234 5698 7654 33' }],
    ['another placeholder', 'firm/cabinet', { holder: '[AUTRE]' }],
    ['a goal in words', 'firm/regles', { 'call-goal': 'dix' }],
  ])('refuse %s, and nothing of the rest is kept', async (_what, path, body) => {
    const answer = await put('director', path, { ...(path.endsWith('cabinet') ? { address: '1 rue de l’Essai' } : {}), ...body });
    expect(answer).toMatchObject({ status: 422, body: { code: 'INVALID', fields: Object.keys(body) } });
    expect(JSON.stringify(answer.body)).not.toContain('7654');
    expect(await rows('SELECT 1 FROM settings')).toEqual([]);
  });

  it('ignore what is locked, read only or unknown, and note nothing when nothing changes', async () => {
    const before = (await rows("SELECT 1 FROM audit_log WHERE action = 'SETTING_CHANGED'")).length;
    expect((await put('director', 'firm/regles', { r1: false, indemnity: '0 €', inconnu: 'x', duration: '6 mois' })).status).toBe(204);
    expect(await rows('SELECT 1 FROM settings')).toEqual([]);
    expect((await rows("SELECT 1 FROM audit_log WHERE action = 'SETTING_CHANGED'")).length).toBe(before);
    expect((await put('director', 'firm/inconnu', {})).status).toBe(404);
    expect((await put('director', 'autre/cabinet', {})).status).toBe(404);
    expect((await get('director', '__proto__')).status).toBe(404);
  });
});

describe('who changes what', () => {
  it.each([
    ['manager', 'firm/relances', { calls: '1' }, 204],
    ['managerAlone', 'firm/relances', { calls: '1' }, 403],
    ['developer', 'firm/relances', { calls: '1' }, 403],
    ['officerA', 'firm/relances', { calls: '1' }, 403],
    ['developer', 'techniques/securite', { x5: false }, 204],
    ['manager', 'techniques/securite', { x5: false }, 403],
    ['director', 'techniques/securite', { x5: false }, 204],
    // Identity and account: the Director alone, with no delegate.
    ['manager', 'firm/cabinet', { iban: IBAN }, 403],
    ['manager', 'firm/cabinet', { chequePayee: 'LEGAREC' }, 403],
    ['manager', 'firm/cabinet', { name: 'LEGAREC SAS' }, 204],
    ['director', 'firm/cabinet', { iban: IBAN }, 204],
  ])('%s, %s %j: %i', async (as, path, body, status) => {
    expect((await put(as, path, body)).status).toBe(status);
  });

  it('is checked again by PostgreSQL', async () => {
    const staff = (id: string, role: 'COLLECTION_MANAGER' | 'DEVELOPER', actingFor: 'ADMINISTRATIVE' | 'TECHNICAL') =>
      ({ kind: 'staff', userId: id, role, delegations: [actingFor], actingFor }) as const;
    const save = (actor: ReturnType<typeof staff>, key: string) =>
      db.run(actor, (tx) => tx.$executeRaw`SELECT app.save_setting(${key}, '"x"'::jsonb, ${randomUUID()}::uuid, NULL)`);
    const manager = staff(test.s.manager, 'COLLECTION_MANAGER', 'ADMINISTRATIVE');
    for (const key of ['firm.cabinet.iban', 'firm.cabinet.chequePayee', 'technical.securite.x5', 'autre.x.y'])
      await expect(save(manager, key), key).rejects.toThrow();
    await expect(save(staff(test.s.developer, 'DEVELOPER', 'TECHNICAL'), 'firm.cabinet.name')).rejects.toThrow();
    await save(manager, 'firm.cabinet.name');
  });

  it('shows the identity locked to all but the Director', async () => {
    expect((await field('director', 'firm/cabinet', 'iban')).locked).toBe(false);
    expect((await field('manager', 'firm/cabinet', 'iban')).locked).toBe(true);
    expect((await field('manager', 'firm/cabinet', 'name')).locked).toBe(false);
  });

  it('keeps the technical settings from the others', async () => {
    for (const as of ['manager', 'officerA']) expect((await get(as, 'techniques')).status).toBe(403);
    expect((await get('manager', 'techniques/audit')).status).toBe(403);
    await put('director', 'techniques/securite', { x5: false });
    const seen = await db.run({ kind: 'staff', userId: test.s.manager, role: 'COLLECTION_MANAGER', delegations: [] }, (tx) => tx.setting.findMany());
    expect(seen).toEqual([]);
  });
});

describe('what is kept of a change', () => {
  it('is the former value, encrypted, with who did it, and no value in the journal', async () => {
    await put('director', 'firm/cabinet', { iban: IBAN, name: 'LEGAREC SAS' });
    await put('director', 'firm/cabinet', { iban: 'DE89 3704 0044 0532 0130 00' });
    const versions = await rows<{ id: string; previous_cipher: Buffer | null; changed_by: string }>(
      "SELECT id, previous_cipher, changed_by FROM setting_versions WHERE key = 'firm.cabinet.iban' ORDER BY changed_at",
    );
    const last = versions.slice(-2);
    expect(last[0]!.previous_cipher).toBeNull();
    expect(new Vault(test.config).openFor({ table: 'setting_versions', id: last[1]!.id, column: 'previous_cipher' }, last[1]!.previous_cipher!)).toBe(
      JSON.stringify(IBAN),
    );
    expect(last.map((row) => row.changed_by)).toEqual([test.s.director, test.s.director]);
    const journal = JSON.stringify(await rows('SELECT * FROM audit_log')) + test.logs.join('');
    for (const value of ['WEST', '0532', 'LEGAREC SAS']) expect(journal).not.toContain(value);
    expect((await section('director', 'techniques/audit')).tables[0]!.rows.map((row) => row[3])).toContain('Identifiants du cabinet modifiés : 1');
  });

  it('is never changed nor read by the others', async () => {
    const seen = (as: 'manager' | 'developer') =>
      db.run({ kind: 'staff', userId: test.s[as], role: as === 'manager' ? 'COLLECTION_MANAGER' : 'DEVELOPER', delegations: [] }, (tx) =>
        tx.settingVersion.findMany({ select: { id: true } }),
      );
    expect(await seen('manager')).toEqual([]);
    expect(await seen('developer')).toEqual([]);
    await put('director', 'firm/cabinet', { name: 'LEGAREC SAS' });
    await expect(rows('DELETE FROM setting_versions')).rejects.toThrow();
    await expect(
      db.run({ kind: 'staff', userId: test.s.director, role: 'DIRECTOR', delegations: [] }, (tx) => tx.$queryRaw`SELECT previous_cipher FROM setting_versions`),
    ).rejects.toThrow();
  });

  it('names the Director on whose behalf it was done', async () => {
    await put('manager', 'firm/relances', { calls: '1' });
    expect(await rows("SELECT updated_by, on_behalf_of_id FROM settings WHERE key = 'firm.relances.calls'")).toEqual([
      { updated_by: test.s.manager, on_behalf_of_id: test.s.director },
    ]);
  });
});

it('is read whole by the worker', async () => {
  await put('director', 'firm/cabinet', { iban: IBAN });
  const jobs = new Database(test.database.url('jobs'));
  try {
    const values = await jobs.run({ kind: 'worker', job: 'x' }, (tx) => SettingValues.read(tx));
    expect(values.text('firm', 'cabinet', 'iban')).toBe(IBAN);
    expect(values.text('firm', 'cabinet', 'siren')).toBe('[SIREN]');
  } finally {
    await jobs.close();
  }
});
