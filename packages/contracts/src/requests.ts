import { z } from 'zod';
import { absenceForm, passwordForm, profileForm, supportTicket } from './account';
import { loginRequest, newPassword, PASSWORD_MAX } from './auth';
import { callQualification } from './calls';
import { addedInvoices, caseCheck, caseNote, debtorCorrection, gdprRequestKind, newCase, newPayment, paymentStatus, renewedCode } from './cases';
import { litigationOutcome, litigationStage, newReminder } from './collection';
import { creditNoteDraftBody, creditNoteIssue } from './creditNotes';
import { coordinate, coordinateKind, coordinateSource, emailCategory, outgoingMessage } from './communication';
import { debtorAccess, debtorIdentifier, debtorMessage, debtorRequest, limitedMessage } from './debtor';
import { depositAcceptance, depositRefusal } from './deposits';
import { composeChannel, letterTemplate } from './documents';
import { bankAccountChange, bankAccountConfirmation, creditorChanges, mandateAmendment, newCreditor } from './creditors';
import { EMAIL_MAX, ID_MAX } from './limits';
import { AMOUNT_MAX, enteredAmount } from './money';
import { newClaim } from './portal';
import { preferences } from './roles';
import { newMailbox, newSecret, redirectionTarget, renewedSecret } from './settings';
import { billingType, newMember, staffRole } from './steering';
import { cents } from './money';

/** Body of every request of the portals: the only definition, read by the API, the forms and the simulations. */

const id = z.string().min(1).max(ID_MAX);
const ids = z.array(id).min(1).max(500);
const line = (max: number) => z.string().trim().min(1).max(max);
const reason = z.string().trim().max(500).optional();
const day = z.iso.date();
/** A total of a batch: a billion euros, far above any. */
const TOTAL_MAX = 100_000_000_000;
/** The batch as it was shown: totals expected, creditors kept out with their reason (R7). */
export const remittanceValidation = z.object({
  until: day,
  /** Each transfer as it was shown: creditor, amount and account; any difference and nothing is validated. */
  expected: z.array(z.object({ creditorId: id, toPay: cents.min(0).max(TOTAL_MAX), accountId: id })).max(500),
  retained: z.array(z.object({ creditorId: id, reason: line(500) })).max(500),
});
export const remittancePaid = z.object({ paidOn: day, expectedTotal: cents.min(0).max(TOTAL_MAX) });

/** Six digits of an application, or a backup code: a wrong one is answered by the API, like any other. */
const oneTimeCode = z.string().trim().min(1).max(20);
/** Answer of the browser, checked by the API itself: only its size is bounded here. */
const webauthnAnswer = z.looseObject({}).refine((answer) => JSON.stringify(answer).length <= 20_000, { error: 'Réponse trop longue.' });

export const loginBody = loginRequest.extend({ remember: z.boolean().default(false) });
export const twoFactorBody = z.discriminatedUnion('method', [
  z.object({ method: z.literal('TOTP'), code: oneTimeCode }),
  z.object({ method: z.literal('BACKUP_CODE'), code: oneTimeCode }),
  z.object({ method: z.literal('WEBAUTHN'), response: webauthnAnswer }),
]);
export const proofBody = z.discriminatedUnion('method', [
  z.object({ method: z.literal('PASSWORD'), password: z.string().min(1).max(PASSWORD_MAX) }),
  z.object({ method: z.literal('TOTP'), code: oneTimeCode }),
  z.object({ method: z.literal('BACKUP_CODE'), code: oneTimeCode }),
  z.object({ method: z.literal('WEBAUTHN'), response: webauthnAnswer }),
]);
export const forgotPasswordBody = z.object({ email: z.email().max(EMAIL_MAX) });
export const passwordBody = z.object({ password: newPassword });
export const oneTimeCodeBody = z.object({ code: oneTimeCode });

export const searchBody = z.object({ query: z.string().trim().max(200) });
export const readBody = z.object({ ids: z.array(id).max(500) });
export const notificationsBody = z.object({ ids, unread: z.boolean() });
export const doneBody = z.object({ done: z.boolean() });
export const activeBody = z.object({ active: z.boolean() });
export const accountPreferencesBody = z
  .object({
    notifications: z.array(z.object({ id, label: z.string().max(200), detail: z.string().max(400), inApp: z.boolean(), email: z.boolean() })).max(50),
    dailySummary: z.boolean(),
    quietHours: z.boolean(),
  })
  .partial();

export const incomingCallBody = z.object({ answered: z.boolean() });
export const aiDecisionBody = z.object({ decision: z.enum(['ACCEPTED', 'IGNORED']) });
export const newCoordinateBody = z.object({
  kind: coordinateKind,
  label: line(40),
  value: line(254),
  primary: z.boolean(),
  replaces: id.nullable(),
  source: coordinateSource,
});
export const coordinateBody = coordinate.pick({ status: true, primary: true }).partial();

export const casesBody = z.object({ ids });
/** `consentReceived`: the written agreement of the creditor is in hand, for the cases whose mandate asks for one. */
export const litigationBody = z.object({ ids, reason: line(500), consentReceived: z.boolean() });
const litigationVersion = z.number().int().min(1).max(1_000_000);
/** Court and partner, typed freely; empty clears them. */
export const litigationFileBody = z.object({ court: z.string().trim().max(200), partnerName: z.string().trim().max(200), version: litigationVersion });
/** The next stage, or closed; closing says what it expects for the case (settled or lost), refused if it changed (409). */
export const litigationStageBody = z
  .object({ stage: litigationStage, expectedOutcome: litigationOutcome.optional(), version: litigationVersion })
  .refine((body) => body.stage !== 'CLOSED' || body.expectedOutcome !== undefined, { path: ['expectedOutcome'] });
export const litigationConsentBody = z.object({ version: litigationVersion });
export const assignBody = z.object({ ids, officerId: id });
export const portalMessageBody = z.object({ text: line(5000) });
/** `version`: that of the payment shown; changed since, it is refused (409). */
export const paymentStatusBody = z.object({
  status: paymentStatus.extract(['CASHED', 'BOUNCED', 'RECONCILED']),
  reason,
  version: z.number().int().min(1).max(1_000_000),
});
/**
 * A reminder from a case. By e-mail: the validated reminder of the level chosen, to an e-mail address of the case (`recipient`).
 * By registered letter: the text typed, to the postal address of the case.
 */
export const reminderChannel = z.enum(['EMAIL', 'REGISTERED_LETTER', 'SMS']);
export type ReminderChannel = z.infer<typeof reminderChannel>;
export const reminderTemplate = letterTemplate.extract(['FRIENDLY', 'FIRM', 'FORMAL_NOTICE']);
/** `message`: for the channels that take a typed text; an e-mail leaves with the validated text of its template, and takes none. */
export const caseReminderBody = z.object({
  channel: reminderChannel,
  template: reminderTemplate,
  recipient: line(300),
  message: line(10_000).optional(),
});
export const gdprRequestBody = z.object({ caseId: id, kind: gdprRequestKind, origin: line(200) });
export const gdprAnswerBody = z.object({ status: z.enum(['OPEN', 'ANSWERED', 'REFUSED']), reason });
/** As many cases as were shown (`GET …/erasure`): any difference and nothing is erased (409). */
export const gdprErasureBody = z.object({ expectedCases: z.number().int().min(0).max(1000), expectedDigest: z.string().regex(/^[0-9a-f]{64}$/u) });

export const reminderBody = z.object({ date: z.iso.date(), time: newReminder.shape.time, done: z.boolean() }).partial();
/** A file sent as the whole body (`POST /documents/import`), up to 15 Mo: its real type is checked by the API. */
export const FILE_MAX_BYTES = 15 * 1024 * 1024;
export const fileBody = z.custom<Uint8Array>((value) => value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= FILE_MAX_BYTES, {
  error: 'Ce fichier est vide ou dépasse 15 Mo.',
});
/** `expected`: the balance shown in the confirmation; the API refuses the plan if it changed since. */
export const paymentPlanBody = z.object({
  caseId: id,
  months: z.number().int().min(1).max(60),
  method: z.enum(['TRANSFER', 'CHEQUE']),
  expected: z.number().int().min(0).max(AMOUNT_MAX),
});
export const planDecisionBody = z.object({ decision: z.enum(['APPROVED', 'REFUSED']), reason, version: z.number().int().min(1).max(1_000_000) });
/** Rate of a semester, in basis points (2,15 % = 215). */
export const interestRateBody = z.object({
  kind: z.enum(['ECB', 'LEGAL_INDIVIDUAL']),
  validFrom: z.iso.date().regex(/^\d{4}-(?:01|07)-01$/u, { error: 'Choisissez le début d’un semestre.' }),
  rateBp: z.number().int().min(0).max(5000, { error: 'Ce taux dépasse 50 %.' }),
  /** The rate shown for this semester, null if none: changed since, it is refused (409). */
  expected: z.number().int().min(0).max(5000).nullable(),
});

export const composeBody = z.object({
  template: letterTemplate,
  caseIds: z.array(id).min(1).max(1).nullable(),
  filters: z.object({ creditor: z.string().max(64), age: z.string().max(20) }).nullable(),
  /** Number of letters confirmed: the API refuses the batch if its own count differs. */
  expected: z.number().int().min(0).max(100_000),
  channel: composeChannel,
  delay: z.number().int().min(0).max(90),
  months: z.number().int().min(1).max(60),
  options: z.object({ table: z.boolean(), pay: z.boolean(), indemnity: z.boolean() }),
});
export const letterDraftBody = z.object({ template: letterTemplate, caseId: id });

export const emailDraftBody = z.object({
  id: id.optional(),
  to: z.string().trim().max(254),
  subject: z.string().trim().max(150),
  text: z.string().max(20_000),
  caseId: id.nullable(),
});
export const archiveBody = z.object({ archived: z.boolean() });
export const emailCategoryBody = z.object({ category: emailCategory });
export const emailReplyBody = z.object({ text: line(20_000), statement: z.boolean().default(false) });
export const smsBody = z.object({ text: line(1600) });
export const linkBody = z.object({ caseId: id });

export const billingBody = z.object({
  type: billingType,
  templateId: id,
  clientId: id,
  lines: z.array(z.object({ label: line(200), quantity: z.number().min(0).max(1_000_000), unitPrice: enteredAmount.min(-AMOUNT_MAX) })).max(100),
  terms: z.array(z.object({ id, label: z.string().max(200), value: z.string().max(2000) })).max(50),
  draft: z.boolean(),
});

export const memberRoleBody = z.object({ role: staffRole });
/** With the number of cases announced by the confirmation: refused when it has changed since. */
export const disableMemberBody = z.object({ reason: line(500), cases: z.number().int().min(0).max(1_000_000) });
export const extensionBody = z.object({
  extension: z
    .string()
    .regex(/^\d{2,6}$/u)
    .nullable(),
});
/** Only the fields that changed; each one is checked against its own definition. */
export const settingsBody = z
  .record(z.string().max(64), z.union([z.string().max(500), z.boolean()]))
  .refine((values) => Object.keys(values).length <= 100, { error: 'Cent réglages au plus.' });
export const mailboxBody = newMailbox.and(z.object({ requestId: id.optional() }));
export const redirectionBody = z.object({ to: redirectionTarget });
export const autoReplyBody = z.object({ text: line(2000), until: z.iso.date().nullable() });

/** Beyond the size of a template the API answers 413; beyond this, nothing is read. */
export const templateImportBody = z.object({ source: z.string().max(1_000_000), fileName: z.string().max(200) });
export const templateRestoreBody = z.object({ version: z.number().int().positive().max(100_000).optional() });
export const templateSubmitBody = z.object({ acknowledged: z.boolean() });
export const templateReviewBody = z.object({ approved: z.boolean(), reason });

export const partnerDecisionBody = z.object({ accepted: z.boolean(), reason });
export const claimBody = newClaim.and(z.object({ attachments: z.array(id).max(20) }));

/** Paths as the simulations write them; the API adds the prefix of the portal. */
export const REQUEST_BODIES = {
  staff: {
    'POST /auth/login': loginBody,
    'POST /auth/two-factor': twoFactorBody,
    'POST /auth/forgot-password': forgotPasswordBody,
    'POST /auth/reset/:token': passwordBody,
    'POST /auth/invitation/:token/password': passwordBody,
    'POST /auth/invitation/:token/totp': oneTimeCodeBody,
    'POST /auth/setup/totp/verify': oneTimeCodeBody,
    'POST /auth/proof': proofBody,
    'PUT /auth/preferences': preferences,
    'POST /notifications/read': readBody,
    'PUT /notifications': notificationsBody,
    'POST /search': searchBody,
    'PUT /dashboard/priorities/:id': doneBody,
    'PUT /account/profile': profileForm,
    'PUT /account/absence': absenceForm,
    'PUT /account/password': passwordForm,
    'PUT /account/notifications': accountPreferencesBody,
    'POST /account/two-factor/totp/verify': oneTimeCodeBody,
    'POST /account/two-factor/webauthn/verify': webauthnAnswer,
    'PUT /delegations/:kind': activeBody,
    'POST /support-tickets': supportTicket,
    'PUT /calls/incoming': incomingCallBody,
    'POST /calls/:id/qualification': callQualification,
    'POST /calls/:id/ai-decision': aiDecisionBody,
    'POST /creditors': newCreditor,
    'PUT /creditors/:id': creditorChanges,
    'POST /creditors/:id/amendments': mandateAmendment,
    'POST /creditors/:id/bank-accounts': bankAccountChange,
    'POST /creditors/:id/bank-accounts/:accountId/confirm': bankAccountConfirmation,
    'POST /cases': newCase,
    'POST /cases/check': caseCheck,
    'POST /cases/:id/invoices': addedInvoices,
    'POST /cases/:id/access-code/regenerate': renewedCode,
    'PUT /cases/:id/debtor': debtorCorrection,
    'POST /cases/:id/notes': caseNote,
    'POST /deposits/:id/accept': depositAcceptance,
    'POST /deposits/:id/refuse': depositRefusal,
    'POST /cases/:id/coordinates': newCoordinateBody,
    'PUT /cases/:id/coordinates/:coordinateId': coordinateBody,
    'POST /cases/search': searchBody,
    'POST /cases/reminders': casesBody,
    'POST /cases/litigation': litigationBody,
    'PUT /litigation/:id': litigationFileBody,
    'POST /litigation/:id/stage': litigationStageBody,
    'POST /litigation/:id/consent': litigationConsentBody,
    'POST /cases/assign': assignBody,
    'POST /cases/:id/portal-messages': portalMessageBody,
    'POST /documents/import': fileBody,
    'POST /cases/:id/payments': newPayment,
    'PUT /cases/:id/payments/:paymentId': paymentStatusBody,
    'POST /cases/:id/reminders': caseReminderBody,
    'POST /gdpr/requests': gdprRequestBody,
    'PUT /gdpr/requests/:id': gdprAnswerBody,
    'POST /gdpr/requests/:id/erasure': gdprErasureBody,
    'POST /reminders': newReminder,
    'PUT /reminders/:id': reminderBody,
    'POST /payment-plans': paymentPlanBody,
    'PUT /payment-plans/requests/:id': planDecisionBody,
    'PUT /interest-rates': interestRateBody,
    'POST /documents/compose': composeBody,
    'POST /documents/compose/draft': letterDraftBody,
    'POST /emails/messages': outgoingMessage,
    'POST /emails/drafts': emailDraftBody,
    'PUT /emails/:id/archive': archiveBody,
    'PUT /emails/:id/category': emailCategoryBody,
    'POST /emails/:id/replies': emailReplyBody,
    'POST /sms/:id/messages': smsBody,
    'POST /sms/:id/link': linkBody,
    'POST /billing': billingBody,
    'POST /remittances': remittanceValidation,
    'POST /remittances/:id/paid': remittancePaid,
    'POST /credit-notes': creditNoteIssue,
    'POST /credit-notes/drafts': creditNoteDraftBody,
    'PUT /credit-notes/drafts/:id': creditNoteDraftBody,
    'PUT /reports/scheduled/:id': activeBody,
    'POST /members': newMember,
    'PUT /members/:id/role': memberRoleBody,
    'POST /members/:id/disable': disableMemberBody,
    'PUT /members/:id/extension': extensionBody,
    'PUT /settings/:scope/:id': settingsBody,
    'POST /secrets': newSecret,
    'POST /secrets/:id/rotate': renewedSecret,
    'POST /mailboxes': mailboxBody,
    'POST /mailboxes/:id/redirections': redirectionBody,
    'PUT /mailboxes/:id/redirections/:redirectionId': redirectionBody,
    'PUT /mailboxes/:id/auto-reply': autoReplyBody,
    'POST /templates/:id/import': templateImportBody,
    'POST /templates/:id/restore': templateRestoreBody,
    'POST /templates/:id/submit': templateSubmitBody,
    'POST /templates/:id/review': templateReviewBody,
  },
  partner: {
    'POST /auth/login': loginBody,
    'POST /auth/two-factor': twoFactorBody,
    'POST /auth/forgot-password': forgotPasswordBody,
    'POST /auth/reset/:token': passwordBody,
    'POST /auth/invitation/:token/password': passwordBody,
    'POST /auth/invitation/:token/totp': oneTimeCodeBody,
    'POST /auth/setup/totp/verify': oneTimeCodeBody,
    'POST /portal/plans/:id/decision': partnerDecisionBody,
    'POST /portal/claims': claimBody,
    'POST /portal/attachments': fileBody,
    'POST /portal/imports': fileBody,
  },
  debtor: {
    'POST /debtor/access': debtorAccess,
    'POST /debtor/code-by-sms': debtorIdentifier,
    'POST /debtor/limited/messages': limitedMessage,
    'POST /debtor/cases/:id/messages': debtorMessage,
    'POST /debtor/cases/:id/requests': debtorRequest,
    'POST /debtor/attachments': fileBody,
  },
} as const satisfies Record<string, Record<string, z.ZodType>>;

/** Schema of a request, found by its method and its real path. Null when that route takes no body. */
export function requestBody(portal: keyof typeof REQUEST_BODIES, method: string, path: string): z.ZodType | null {
  const parts = path.split('/').filter(Boolean);
  const entries = Object.entries(REQUEST_BODIES[portal] as Record<string, z.ZodType>).filter(([key]) => {
    const [verb, model = ''] = key.split(' ');
    const expected = model.split('/').filter(Boolean);
    return verb === method && expected.length === parts.length && expected.every((part, index) => part.startsWith(':') || part === parts[index]);
  });
  // `/cases/reminders` before `/cases/:id`: the most precise path wins.
  entries.sort(([left], [right]) => left.split(':').length - right.split(':').length);
  return entries[0]?.[1] ?? null;
}

/** Whether the API would accept this JSON body: the simulations refuse what it would refuse. */
export function acceptsBody(portal: keyof typeof REQUEST_BODIES, method: string, path: string, json: string): boolean {
  const schema = requestBody(portal, method, path);
  if (!schema) return json === '' || json === '{}';
  try {
    return schema.safeParse(json === '' ? undefined : JSON.parse(json)).success;
  } catch {
    return false;
  }
}
