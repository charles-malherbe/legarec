import { z } from 'zod';
import { accessCode } from './debtorAccess';
import { messageBlock } from './messageText';

/**
 * One schema per e-mail template, deduced from samples.json and from the header of each template.
 * Unknown keys are dropped: `case.access_code` is declared for the three reminders only, so no other template can carry it.
 */
const text = z.string().min(1);
const optional = z.string().optional();
/** The kit's reminders ask for a SIREN: they are for companies only, never for an individual. */
const siren = z.string().regex(/^\d{3} ?\d{3} ?\d{3}$/u);
const count = z.number().int().nonnegative();
/** HTTPS; the portals of a development machine too. */
const url = z.union([z.url({ protocol: /^https$/u }), z.url({ protocol: /^http$/u, hostname: /^localhost$/u })]);
const flag = z.boolean();

export const emailSchemas = {
  'case-closed': z.object({
    case: z.object({ closed_date: optional, reference: text, total_paid: optional }),
    certificate_url: url.optional(),
    creditor: z.object({ name: text }),
  }),
  'cheque-bounced': z.object({
    action_url: url.optional(),
    case: z.object({ balance: text, deadline: optional, reference: text }),
    cheque: z.object({ amount: text, number: text, received_date: optional, rejection_reason: optional }),
  }),
  'creditor-invitation': z.object({
    creditor: z.object({ name: text }),
    expires_in: optional,
    invitation_url: url,
    inviter: z.object({ name: text }),
    recipient: z.object({ first_name: optional }).optional(),
  }),
  'creditor-new-activity': z.object({
    action_url: url,
    activity: z.object({ author: optional, date: optional, document_name: optional, is_document: flag, subject: optional }),
    case: z.object({ reference: text }),
    debtor: z.object({ company_name: text }),
    recipient: z.object({ first_name: optional }).optional(),
  }),
  'creditor-password-reset': z.object({
    expires_in: optional,
    recipient: z.object({ first_name: optional }).optional(),
    requested_at: optional,
    reset_url: url,
  }),
  'debtor-new-message': z.object({
    action_url: url,
    case: z.object({ reference: text }),
    creditor: z.object({ name: text }),
    message: z.object({ sent_at: optional, subject: optional }).optional(),
  }),
  'debtor-request-received': z.object({
    action_url: url.optional(),
    case: z.object({ reference: text }),
    request: z.object({ reference: optional, response_delay: optional, submitted_at: optional, type_label: text }),
  }),
  'delegation-changed': z.object({
    action_url: url,
    delegation: z.object({
      changed_at: optional,
      changed_by: optional,
      end_date: optional,
      from_name: text,
      scope_label: text,
      start_date: optional,
      status_label: text,
      to_name: text,
    }),
    recipient: z.object({ first_name: optional }).optional(),
  }),
  'email-verification': z.object({
    expires_in: optional,
    recipient: z.object({ email: z.email(), first_name: optional }),
    verification_code: optional,
    verification_url: url,
  }),
  'import-report': z.object({
    creditor: z.object({ name: text }),
    import: z.object({
      created: count,
      date: optional,
      errors: z.array(z.object({ line: count, message: text })).optional(),
      errors_more: count.optional(),
      file_name: text,
      has_errors: flag,
      rejected: count,
      total_rows: count,
      updated: count,
    }),
    recipient: z.object({ first_name: optional }).optional(),
    report_url: url,
  }),
  'installment-missed': z.object({
    action_url: url.optional(),
    case: z.object({ balance: text, reference: text }),
    installment: z.object({ amount: text, due_date: text, grace_deadline: optional, number: count }),
    plan: z.object({ installment_count: count }),
  }),
  'installment-reminder': z.object({
    action_url: url.optional(),
    case: z.object({ reference: text }),
    installment: z.object({ amount: text, balance_after: optional, due_date: text, number: count }),
    plan: z.object({ installment_count: count }),
  }),
  'notifications-digest': z.object({
    action_url: url,
    digest: z.object({
      count_label: optional,
      items: z.array(z.object({ case_reference: optional, date: optional, description: optional, title: text, url: url.optional() })).min(1),
      more_count: count.optional(),
      period_label: optional,
    }),
    recipient: z.object({ first_name: optional }).optional(),
    settings_url: url.optional(),
  }),
  'ops-alert': z.object({
    alert: z.object({
      dashboard_url: url.optional(),
      description: text,
      details: optional,
      environment: optional,
      is_critical: flag,
      metrics: z.array(z.object({ label: text, value: text })).optional(),
      resolved_at: optional,
      runbook_url: url.optional(),
      service: text,
      severity_label: text,
      started_at: text,
      title: text,
    }),
  }),
  'payment-plan-approval-request': z.object({
    approval_url: url,
    case: z.object({ balance: text, reference: text }),
    debtor: z.object({ company_name: text }),
    plan: z.object({
      debtor_comment: optional,
      duration_label: text,
      firm_opinion: optional,
      first_due_date: text,
      installment_amount: text,
      installment_count: count,
      last_due_date: text,
    }),
    recipient: z.object({ first_name: optional }).optional(),
    response_deadline: optional,
  }),
  'payment-plan-decision': z.object({
    action_url: url.optional(),
    case: z.object({ balance: text, deadline: optional, reference: text }),
    plan: z.object({
      approved: flag,
      installments: z.array(z.object({ amount: text, due_date: text, number: count })).min(1),
      refusal_reason: optional,
      total: optional,
    }),
  }),
  receipt: z.object({
    case: z.object({ balance: text, fully_paid: flag, reference: text }),
    creditor: z.object({ name: text }),
    payment: z.object({ amount: text, date: text, method_label: text, reference: optional, subject_to_collection: flag }),
    receipt_url: url.optional(),
  }),
  'reminder-1': z.object({
    case: z.object({ access_code: accessCode.optional(), deadline: optional, reference: text, total_due: text }),
    creditor: z.object({ establishment: optional, name: text }),
    debtor: z.object({ company_name: text, contact_name: optional, siren }),
    invoices: z
      .array(z.object({ due_date: text, interest: optional, issue_date: text, late_fees: optional, number: text, principal: text, total: text }))
      .min(1),
  }),
  'reminder-2': z.object({
    case: z.object({ access_code: accessCode.optional(), deadline: optional, reference: text, total_due: text }),
    creditor: z.object({ establishment: optional, name: text }),
    debtor: z.object({ company_name: text, contact_name: optional, siren }),
    invoices: z
      .array(z.object({ due_date: text, interest: optional, issue_date: text, late_fees: optional, number: text, principal: text, total: text }))
      .min(1),
  }),
  'reminder-3': z.object({
    case: z.object({ access_code: accessCode.optional(), deadline: optional, reference: text, total_due: text }),
    creditor: z.object({ establishment: optional, name: text }),
    debtor: z.object({ company_name: text, contact_name: optional, siren }),
    invoices: z
      .array(z.object({ due_date: text, interest: optional, issue_date: text, late_fees: optional, number: text, principal: text, total: text }))
      .min(1),
  }),
  'remittance-invoice': z.object({
    creditor: z.object({ name: text }),
    invoice: z.object({ amount_excl_tax: text, amount_incl_tax: text, number: text, settled_by_offset: flag, vat: text }),
    invoice_url: url,
    lines: z.array(z.object({ case_reference: text, collected: text, debtor_name: text, net: text })).optional(),
    lines_more: count.optional(),
    recipient: z.object({ first_name: optional }).optional(),
    remittance: z.object({ bank_account: optional, collected: text, date: text, fees: text, net_amount: text, period: optional, reference: text }),
    statement_url: url.optional(),
  }),
  'staff-2fa-enabled': z.object({
    event: z.object({ date: text, ip: optional, method_label: optional }),
    recipient: z.object({ first_name: optional }).optional(),
  }),
  'staff-invitation': z.object({
    expires_in: optional,
    invitation_url: url,
    inviter: z.object({ name: text }),
    recipient: z.object({ first_name: optional }).optional(),
    requires_2fa: flag,
    role_label: optional,
  }),
  'staff-new-device': z.object({
    device: z.object({ browser: optional, ip: optional, location: optional, login_at: text, name: optional }),
    recipient: z.object({ first_name: optional }).optional(),
    secure_url: url.optional(),
  }),
  'staff-password-reset': z.object({ expires_in: optional, recipient: z.object({ first_name: optional }).optional(), requested_at: optional, reset_url: url }),
} as const;

export type AutomaticEmail = keyof typeof emailSchemas;
export const AUTOMATIC_EMAILS = Object.keys(emailSchemas) as AutomaticEmail[];
/** Only these e-mails accept replies, sent to the shared mailbox. */
export const REPLY_ACCEPTED: readonly AutomaticEmail[] = ['reminder-1', 'reminder-2', 'reminder-3'];

/** Message written by an employee, sent from their own OVH mailbox. */
export const staffMessage = z.object({
  message: z.object({ subject: text, preview: optional, blocks: z.array(messageBlock).min(1).max(100), closing: optional }),
  case: z.object({ reference: text }).optional(),
  creditor: z.object({ name: text }).optional(),
  debtor_recipient: z.boolean(),
  sender: z.object({
    full_name: text,
    job_title: optional,
    email: z.email(),
    phone: optional,
    phone_href: optional,
    extension: z
      .string()
      .regex(/^\d{1,6}$/u)
      .optional(),
  }),
});
export type StaffMessageData = z.infer<typeof staffMessage>;

/** Configuration of the firm, read by the API from its environment or its settings. */
export const emailConfig = z.object({
  firm_name: text,
  firm_tagline: optional,
  logo_url: url.optional(),
  logo_width: z.number().int().optional(),
  logo_dark_url: url.optional(),
  firm_siren: text,
  phone: text,
  phone_href: text,
  collection_email: z.email(),
  support_email: z.email(),
  portal_url: url,
  portal_label: text,
  account_holder: text,
  bank_name: optional,
  iban: text,
  bic: text,
  cheque_payee: text,
  cheque_address: text,
  plan_approval_threshold: text,
  firm_address: text,
  website_url: url,
  website_label: text,
});
export type EmailConfig = z.infer<typeof emailConfig>;
