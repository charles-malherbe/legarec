import { emailConfig, type EmailConfig } from '@legarec/contracts';
import { formatPhone } from './phone';

/**
 * Values of the firm until they are read from its settings (lot L): those that only the firm knows stay between brackets,
 * which is enough for messages that go nowhere.
 */
export const provisionalEmailConfig = (): EmailConfig => {
  const phone = formatPhone('01 87 88 02 98');
  return emailConfig.parse({
    firm_name: 'LEGAREC',
    firm_tagline: 'Cabinet de recouvrement amiable',
    logo_url: 'https://media.legarec.fr/e-mails/v1/legarec-logo-en-tete.png',
    logo_width: 260,
    logo_dark_url: 'https://media.legarec.fr/e-mails/v1/legarec-logo-en-tete-negatif.png',
    firm_siren: '[SIREN]',
    phone: phone.national,
    phone_href: phone.international,
    collection_email: 'recouvrement@legarec.fr',
    support_email: 'support@legarec.fr',
    portal_url: 'https://paiement.legarec.fr',
    portal_label: 'paiement.legarec.fr',
    account_holder: '[TITULAIRE DU COMPTE]',
    iban: '[IBAN DU COMPTE DÉDIÉ]',
    bic: '[BIC]',
    cheque_payee: '[ORDRE DES CHÈQUES]',
    cheque_address: '[ADRESSE D’ENVOI DES CHÈQUES]',
    plan_approval_threshold: '6 mois',
    firm_address: '[ADRESSE DU CABINET]',
    website_url: 'https://www.legarec.fr',
    website_label: 'www.legarec.fr',
  });
};

/** Builds the `config` object of the templates from the environment. Throws when a value is missing. */
export function readEmailConfig(env: Record<string, string | undefined>): EmailConfig {
  const media = env.MEDIA_BASE_URL?.replace(/\/$/u, '');
  const phone = formatPhone(env.FIRM_PHONE ?? '');
  return emailConfig.parse({
    firm_name: env.FIRM_NAME,
    firm_tagline: env.FIRM_TAGLINE || undefined,
    logo_url: media && `${media}/e-mails/v1/legarec-logo-en-tete.png`,
    logo_width: 260,
    logo_dark_url: media && `${media}/e-mails/v1/legarec-logo-en-tete-negatif.png`,
    firm_siren: env.FIRM_SIREN,
    phone: phone.national,
    phone_href: phone.international,
    collection_email: env.COLLECTION_EMAIL,
    support_email: env.SUPPORT_EMAIL,
    portal_url: env.DEBTOR_PORTAL_URL,
    portal_label: env.DEBTOR_PORTAL_URL?.replace(/^https:\/\//u, '').replace(/\/$/u, ''),
    account_holder: env.ACCOUNT_HOLDER,
    bank_name: env.BANK_NAME || undefined,
    iban: env.BANK_IBAN,
    bic: env.BANK_BIC,
    cheque_payee: env.CHEQUE_PAYEE,
    cheque_address: env.CHEQUE_ADDRESS,
    plan_approval_threshold: env.PLAN_APPROVAL_THRESHOLD,
    firm_address: env.FIRM_ADDRESS,
    website_url: env.WEBSITE_URL,
    website_label: env.WEBSITE_URL?.replace(/^https:\/\//u, '').replace(/\/$/u, ''),
  });
}
