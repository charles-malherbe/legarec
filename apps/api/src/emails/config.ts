import { emailConfig, type EmailConfig } from '@legarec/contracts';
import { formatPhone } from './phone';

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
