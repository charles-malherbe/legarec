// @vitest-environment node
import { AUTOMATIC_EMAILS, emailConfig, emailSchemas, REPLY_ACCEPTED, type AutomaticEmail } from '@legarec/contracts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { emailConfigOf } from './config';
import { EmailsService, AUTOMATIC_SENDER, type AutomaticMessage } from './emails.service';
import type { SettingValues } from '../modules/settings/values';
import { EmailRenderer, TEMPLATES_DIR } from './renderer';
import {
  HOURLY_QUOTA,
  QuotaExceeded,
  SHARED_MAILBOX,
  SharedMailboxIsReceiveOnly,
  StaffMessagesService,
  toBlocks,
  type StaffSender,
} from './staff-messages.service';

const KIT = join(process.cwd(), 'kits/emails-handlebars');
const ADDON = join(process.cwd(), 'kits/emails-ajout-staff-message');
const SAMPLES = JSON.parse(readFileSync(join(KIT, 'samples.json'), 'utf8')) as Record<AutomaticEmail, Record<string, unknown>>;
// The kit shows a placeholder of another length: the portal only accepts four letters.
for (const sample of Object.values(SAMPLES)) {
  const entry = sample.case as Record<string, unknown> | undefined;
  if (entry) delete entry.access_code;
}
// Fictitious configuration: the firm's values stay out of the repository's code.
const config = emailConfig.parse({
  firm_name: 'LEGAREC',
  firm_tagline: 'Cabinet de recouvrement',
  logo_url: 'https://media.legarec.fr/e-mails/v1/legarec-logo-en-tete.png',
  logo_width: 260,
  logo_dark_url: 'https://media.legarec.fr/e-mails/v1/legarec-logo-en-tete-negatif.png',
  firm_siren: '[SIREN]',
  phone: '01 87 88 02 98',
  phone_href: '+33187880298',
  collection_email: 'recouvrement@legarec.fr',
  support_email: 'administratif@legarec.fr',
  portal_url: 'https://paiement.legarec.fr',
  portal_label: 'paiement.legarec.fr',
  account_holder: 'LEGAREC',
  iban: '[IBAN DU COMPTE DÉDIÉ]',
  bic: '[BIC]',
  cheque_payee: '[ORDRE DES CHÈQUES]',
  cheque_address: '[ADRESSE D’ENVOI DES CHÈQUES]',
  plan_approval_threshold: '6 mois',
  firm_address: '[ADRESSE DU CABINET]',
  website_url: 'https://www.legarec.fr',
  website_label: 'www.legarec.fr',
});
const kit = new EmailRenderer(TEMPLATES_DIR);
const renderer = { renderAutomatic: (name: AutomaticEmail, data: unknown) => kit.renderAutomatic(name, data, config) };
const count = (html: string, part: string) => html.split(part).length - 1;

describe('kit', () => {
  it('copies every file of the kits without rewriting it', () => {
    for (const [kit, folders] of [
      [KIT, ['.', 'partials', 'templates']],
      [ADDON, ['partials', 'templates']],
    ] as const)
      for (const folder of folders)
        for (const file of readdirSync(join(kit, folder)).filter((name) => name.endsWith('.hbs') || name === 'subjects.json'))
          expect(readFileSync(join(TEMPLATES_DIR, folder, file), 'utf8')).toBe(readFileSync(join(kit, folder, file), 'utf8'));
  });
  it('has a schema and a subject for each of the 25 templates', () => {
    const subjects = JSON.parse(readFileSync(join(KIT, 'subjects.json'), 'utf8')) as object;
    expect(AUTOMATIC_EMAILS).toHaveLength(25);
    expect(Object.keys(subjects).sort()).toEqual([...AUTOMATIC_EMAILS].sort());
    expect(Object.keys(SAMPLES).sort()).toEqual([...AUTOMATIC_EMAILS].sort());
  });
  it.each(AUTOMATIC_EMAILS)('renders %s like its reference', async (name) => {
    const { subject, html } = renderer.renderAutomatic(name, SAMPLES[name]);
    expect(subject).not.toMatch(/\{\{|undefined/u);
    expect(html).not.toMatch(/\{\{|undefined|\[object/u);
    await expect(`${subject}\n\n${html}`).toMatchFileSnapshot(`__snapshots__/${name}.html`);
  });
  it.each(AUTOMATIC_EMAILS.filter((name) => !REPLY_ACCEPTED.includes(name)))('never passes the access code to %s', (name) => {
    const sample = { ...SAMPLES[name], case: { ...(SAMPLES[name].case as object), access_code: 'KXPM' } };
    expect(JSON.stringify(emailSchemas[name].parse(sample))).not.toContain('access_code');
    expect(renderer.renderAutomatic(name, sample).html).not.toMatch(/KXPM|EXEMPLE/u);
  });
  it.each(REPLY_ACCEPTED)('carries the access code in %s, in the body only', (name) => {
    const { subject, html } = renderer.renderAutomatic(name, { ...SAMPLES[name], case: { ...(SAMPLES[name].case as object), access_code: 'KXPM' } });
    expect(html).toContain('KXPM');
    expect(subject).not.toContain('KXPM');
    expect(html).not.toMatch(/href="[^"]*KXPM/u);
  });
  it.each(REPLY_ACCEPTED)('refuses %s for an individual, who has no SIREN', (name) => {
    const sample = SAMPLES[name] as { debtor: object };
    for (const siren of ['', 'LGR-2026-00181']) expect(() => renderer.renderAutomatic(name, { ...sample, debtor: { ...sample.debtor, siren } })).toThrow();
  });
  it('refuses incomplete data and links that are not https', () => {
    expect(() => renderer.renderAutomatic('receipt', {})).toThrow();
    expect(() => renderer.renderAutomatic('staff-password-reset', { ...SAMPLES['staff-password-reset'], reset_url: 'javascript:alert(1)' })).toThrow();
  });
  it('escapes the body and keeps the subject as one line of plain text', () => {
    const data = structuredClone(SAMPLES['creditor-new-activity']) as { case: { reference: string }; activity: { author: string } };
    data.activity.author = '<img src=x onerror=alert(1)>';
    data.case.reference = 'A & B\r\nBcc: x@y.fr';
    const { subject, html } = renderer.renderAutomatic('creditor-new-activity', data);
    expect(html).not.toContain('<img src=x');
    expect(subject).toContain('A & B Bcc');
    expect(subject).not.toMatch(/[\r\n]/u);
  });
});

describe('automatic e-mails', () => {
  const collect = () => {
    const messages: AutomaticMessage[] = [];
    const send = (message: AutomaticMessage) => {
      messages.push(message);
      return Promise.resolve();
    };
    return { messages, service: new EmailsService(kit, { send }, () => Promise.resolve(config)) };
  };
  it('accepts replies on the three reminders only', async () => {
    const { messages, service } = collect();
    for (const name of AUTOMATIC_EMAILS) await service.send(name, 'x@exemple.fr', SAMPLES[name]);
    const withReply = AUTOMATIC_EMAILS.filter((_name, index) => messages[index]?.replyTo !== undefined);
    expect(withReply).toEqual(['reminder-1', 'reminder-2', 'reminder-3']);
    expect(messages.every((message) => message.from === AUTOMATIC_SENDER && (message.replyTo ?? SHARED_MAILBOX) === SHARED_MAILBOX)).toBe(true);
  });
  it('takes the role of an invitation from the labels of the application', async () => {
    const { messages, service } = collect();
    await service.inviteStaff('x@exemple.fr', 'CLAIMS_OFFICER', { inviter: 'Marie Dubreuil', invitation_url: 'https://espace.legarec.fr/activation/abc' });
    expect(messages[0]?.html).toContain('Gestionnaire de créances');
  });
});

describe('staff message', () => {
  const sender: StaffSender = {
    firstName: 'Camille',
    lastName: 'Laurent',
    role: 'COLLECTION_MANAGER',
    email: 'cl@legarec.fr',
    phone: '0187880298',
    extension: '101',
  };
  const input = {
    to: 'compta@exemple.fr',
    subject: 'Votre dossier',
    text: 'Bonjour,\n\nNous avons reçu 4 320,00 € le 14/11.\n\nMerci.',
    recipientIsDebtor: true,
    caseReference: 'LGR-2026-04812',
    creditorName: 'Matériaux Delta',
  };
  const make = (transport = { send: vi.fn(() => Promise.resolve()), appendToSent: vi.fn(() => Promise.resolve()) }, now?: () => number) => ({
    transport,
    service: new StaffMessagesService(kit, config, transport, now),
  });
  it.each([
    ['debtor', true],
    ['creditor', false],
  ] as const)('renders a message to a %s like its reference', async (name, recipientIsDebtor) => {
    const { html } = make().service.build(sender, { ...input, recipientIsDebtor });
    await expect(html).toMatchFileSnapshot(`__snapshots__/staff-message-${name}.html`);
  });
  it('reminds the legal text to debtors only, and shows each item once', () => {
    const { service } = make();
    for (const recipientIsDebtor of [true, false]) {
      const { html } = service.build(sender, { ...input, recipientIsDebtor });
      expect(html.includes('L111-8')).toBe(recipientIsDebtor);
      expect(html).toContain('Vous pouvez répondre directement');
      expect(count(html, 'LGR-2026-04812')).toBe(1);
      expect(count(html, '[SIREN]')).toBe(1);
    }
  });
  it('escapes the typed text', () => {
    const { html } = make().service.build(sender, { ...input, text: '<script>alert(1)</script>' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script');
  });
  it('shows the role and the extension only when they are known', () => {
    const { service } = make();
    const full = service.build(sender, input).html;
    expect(full).toContain('Responsable du recouvrement');
    expect(full).toContain('poste 101');
    expect(full).toContain('tel:+33187880298,101');
    const bare = service.build({ ...sender, role: null, extension: null, phone: null }, input).html;
    expect(bare).not.toContain('Responsable du recouvrement');
    expect(bare).not.toContain('poste');
    expect(bare).toContain('tel:+33187880298');
  });
  it('sends from the employee’s mailbox without any replyTo, then copies it to the sent items', async () => {
    const { service, transport } = make();
    const { copied, ...message } = await service.send(sender, input);
    expect(copied).toBe(true);
    expect(message.from).toBe('"Camille LAURENT" <cl@legarec.fr>');
    expect(message).not.toHaveProperty('replyTo');
    expect(transport.send).toHaveBeenCalledWith('cl@legarec.fr', message);
    expect(transport.appendToSent).toHaveBeenCalledWith('cl@legarec.fr', message);
  });
  it('never writes from the shared mailbox', async () => {
    const { service, transport } = make();
    await expect(service.send({ ...sender, email: SHARED_MAILBOX }, input)).rejects.toThrow(SharedMailboxIsReceiveOnly);
    expect(transport.send).not.toHaveBeenCalled();
  });
  it('stops before the hourly quota, per mailbox', async () => {
    let time = 0;
    const { service, transport } = make(undefined, () => time);
    for (let index = 0; index < HOURLY_QUOTA; index += 1) await service.send(sender, input);
    await expect(service.send(sender, input)).rejects.toThrow(QuotaExceeded);
    expect(transport.send).toHaveBeenCalledTimes(HOURLY_QUOTA);
    expect(service.remaining('hb@legarec.fr')).toBe(HOURLY_QUOTA);
    time = 3_600_000;
    expect(service.remaining(sender.email)).toBe(HOURLY_QUOTA);
  });
  it('surfaces an OVH failure, without any fallback', async () => {
    const { service, transport } = make({ send: vi.fn(() => Promise.reject(new Error('535'))), appendToSent: vi.fn(() => Promise.resolve()) });
    await expect(service.send(sender, input)).rejects.toThrow('535');
    expect(transport.appendToSent).not.toHaveBeenCalled();
    expect(service.remaining(sender.email)).toBe(HOURLY_QUOTA);
  });
  it('splits paragraphs at blank lines and protects amounts', () => {
    expect(toBlocks('A\r\n\r\n4 320,00 €\n \n\nB')).toEqual([
      { paragraph: [{ text: 'A' }] },
      { paragraph: [{ text: '4 320,00 €' }] },
      { paragraph: [{ text: 'B' }] },
    ]);
  });
  it('renders bold, italic and lists from the marks of the text, every word escaped', () => {
    const text = 'Le solde est de **4 320,00 €**, *à régler* avant le 05/12.\n\n- F-2026-0712\n- **<b>F-2026-0713</b>**\n\n1. Virement\n2. Chèque';
    const { html } = make().service.build(sender, { ...input, text });
    expect(html).toContain('<strong>4 320,00 €</strong>');
    expect(html).toContain('<em>à régler</em>');
    expect(count(html, '<li ')).toBe(4);
    expect(html).toMatch(/<ul [^>]*><li [^>]*>F-2026-0712<\/li><li [^>]*><strong>&lt;b&gt;F-2026-0713&lt;\/b&gt;<\/strong><\/li><\/ul>/u);
    expect(html).toMatch(/<ol [^>]*><li [^>]*>Virement<\/li><li [^>]*>Chèque<\/li><\/ol>/u);
    expect(html).not.toContain('<b>');
  });
});

it('reads the configuration from the settings of the firm, what it has not typed staying between brackets', () => {
  const values = (changed: Record<string, string>) =>
    ({ text: (_scope: string, section: string, field: string) => changed[`${section}.${field}`] ?? '[À COMPLÉTER]' }) as unknown as SettingValues;
  const portals = { DEBTOR_PORTAL_URL: 'https://paiement.legarec.fr' };
  const known = { 'cabinet.phone': '01 87 88 02 98', 'cabinet.iban': 'GB82 WEST 1234 5698 7654 32', 'regles.duration': '6 mois' };
  expect(emailConfigOf(values(known), portals)).toMatchObject({
    phone: '01 87 88 02 98',
    phone_href: '+33187880298',
    iban: 'GB82 WEST 1234 5698 7654 32',
    firm_siren: '[À COMPLÉTER]',
    plan_approval_threshold: '6 mois',
    portal_label: 'paiement.legarec.fr',
    logo_url: 'https://media.legarec.fr/e-mails/v1/legarec-logo-en-tete.png',
  });
  expect(() => emailConfigOf(values({ ...known, 'cabinet.phone': 'bientôt' }), portals)).toThrow();
});
