import { plainOf, readMessage, ROLE_LABELS, type EmailConfig, type MessageBlock, type Role } from '@legarec/contracts';
import { z } from 'zod';
import { formatPhone } from './phone';
import type { EmailRenderer } from './renderer';

const HOUR = 3_600_000;
/** MX Plan allows about 200 e-mails per hour and per mailbox: stop before. */
export const HOURLY_QUOTA = 180;
export const SHARED_MAILBOX = 'recouvrement@legarec.fr';

export interface StaffSender {
  firstName: string;
  lastName: string;
  role: Role | null;
  email: string;
  phone?: string | null;
  extension?: string | null;
}
export interface StaffMessageInput {
  to: string;
  subject: string;
  text: string;
  recipientIsDebtor: boolean;
  caseReference?: string;
  creditorName?: string;
}
export interface OutgoingStaffMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
}
/** SMTP of the sender's own OVH mailbox, then IMAP APPEND to its sent items. Simulated in the tests. */
export interface MailboxTransport {
  send(mailbox: string, message: OutgoingStaffMessage): Promise<void>;
  appendToSent(mailbox: string, message: OutgoingStaffMessage): Promise<void>;
}
export class QuotaExceeded extends Error {}
export class DebtorReferenceRequired extends Error {}
export class SharedMailboxIsReceiveOnly extends Error {}

const NBSP = '\u00a0';
const keepTogether = (text: string) => text.replace(/(?<=\d)[ \u202f](?=\d)/gu, NBSP).replace(/(?<=\d)[ \u202f](?=€)/gu, NBSP);
/** The text typed, read into blocks with its marks (`messageText.ts`), with no-break spaces inside numbers and amounts. */
export const toBlocks = (text: string): MessageBlock[] =>
  readMessage(text).map((block) => {
    const runs = (list: { text: string }[]) => list.map((run) => ({ ...run, text: keepTogether(run.text) }));
    if ('paragraph' in block) return { paragraph: runs(block.paragraph) };
    if ('bullets' in block) return { bullets: block.bullets.map(runs) };
    return { numbers: block.numbers.map(runs) };
  });

/** Messages written by an employee: never through Resend, not even when OVH fails. */
export class StaffMessagesService {
  private readonly sent = new Map<string, number[]>();

  constructor(
    private readonly renderer: EmailRenderer,
    private readonly config: EmailConfig,
    private readonly transport: MailboxTransport,
    private readonly now: () => number = Date.now,
  ) {}

  remaining(mailbox: string): number {
    return HOURLY_QUOTA - this.recent(mailbox).length;
  }

  async send(sender: StaffSender, input: StaffMessageInput): Promise<OutgoingStaffMessage & { copied: boolean }> {
    // One valid address only: no list nor header injection.
    z.email().parse(input.to);
    if (input.recipientIsDebtor && !input.caseReference) throw new DebtorReferenceRequired();
    if (sender.email.toLowerCase() === SHARED_MAILBOX) throw new SharedMailboxIsReceiveOnly();
    if (this.remaining(sender.email) <= 0) throw new QuotaExceeded();
    const message = this.build(sender, input);
    await this.transport.send(sender.email, message);
    this.sent.set(sender.email.toLowerCase(), [...this.recent(sender.email), this.now()]);
    // The message has left: a failed copy must not make it look unsent.
    const copied = await this.transport.appendToSent(sender.email, message).then(
      () => true,
      () => false,
    );
    return { ...message, copied };
  }

  build(sender: StaffSender, input: StaffMessageInput): OutgoingStaffMessage {
    const blocks = toBlocks(input.text);
    const phone = sender.phone ? formatPhone(sender.phone) : null;
    const fullName = `${sender.firstName} ${sender.lastName.toLocaleUpperCase('fr-FR')}`;
    const { subject, html } = this.renderer.renderStaffMessage(
      {
        message: { subject: input.subject, preview: blocks[0] && plainOf(blocks[0]).slice(0, 120), blocks },
        case: input.caseReference ? { reference: input.caseReference } : undefined,
        creditor: input.creditorName ? { name: input.creditorName } : undefined,
        debtor_recipient: input.recipientIsDebtor,
        sender: {
          full_name: fullName,
          job_title: sender.role ? ROLE_LABELS[sender.role] : undefined,
          email: sender.email,
          phone: phone?.national,
          phone_href: phone?.international,
          extension: sender.extension ?? undefined,
        },
      },
      this.config,
    );
    return { from: `"${fullName.replace(/["\\\r\n]/gu, '')}" <${sender.email}>`, to: input.to, subject, html };
  }

  private recent(mailbox: string): number[] {
    return (this.sent.get(mailbox.toLowerCase()) ?? []).filter((time) => this.now() - time < HOUR);
  }
}
