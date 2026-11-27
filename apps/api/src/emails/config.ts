import { emailConfig, type EmailConfig } from '@legarec/contracts';
import type { Config } from '../platform/config/config';
import type { SettingValues } from '../modules/settings/values';
import { PLACEHOLDER } from '../platform/pdf/pdf';
import { formatPhone } from './phone';

/** Whether the firm still has a value to type: its messages would leave with brackets. What a message says of a debtor is never looked at. */
export const firmIncomplete = (config: EmailConfig) => Object.values(config).some((value) => typeof value === 'string' && PLACEHOLDER.test(value));

const MEDIA = 'https://media.legarec.fr';
const label = (url: string) => url.replace(/^https?:\/\//u, '').replace(/\/$/u, '');

/** The `config` object of the templates, from Paramètres du cabinet. What the firm has not typed yet stays between brackets. */
export function emailConfigOf(values: SettingValues, { DEBTOR_PORTAL_URL }: Pick<Config, 'DEBTOR_PORTAL_URL'>): EmailConfig {
  const firm = (field: string) => values.text('firm', 'cabinet', field);
  const phone = formatPhone(firm('phone'));
  return emailConfig.parse({
    firm_name: firm('name'),
    firm_tagline: 'Cabinet de recouvrement amiable',
    logo_url: `${MEDIA}/e-mails/v1/legarec-logo-en-tete.png`,
    logo_width: 260,
    logo_dark_url: `${MEDIA}/e-mails/v1/legarec-logo-en-tete-negatif.png`,
    firm_siren: firm('siren'),
    phone: phone.national,
    phone_href: phone.international,
    collection_email: 'recouvrement@legarec.fr',
    support_email: 'support@legarec.fr',
    portal_url: DEBTOR_PORTAL_URL,
    portal_label: label(DEBTOR_PORTAL_URL),
    account_holder: firm('holder'),
    bank_name: firm('bankName'),
    iban: firm('iban'),
    bic: firm('bic'),
    cheque_payee: firm('chequePayee'),
    cheque_address: firm('chequeAddress'),
    plan_approval_threshold: values.text('firm', 'regles', 'duration'),
    firm_address: firm('address'),
    website_url: 'https://www.legarec.fr',
    website_label: 'www.legarec.fr',
  });
}
