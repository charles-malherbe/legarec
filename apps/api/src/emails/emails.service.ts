import { REPLY_ACCEPTED, ROLE_LABELS, type AutomaticEmail, type EmailConfig, type Role } from '@legarec/contracts';
import type { EmailRenderer } from './renderer';

export const AUTOMATIC_SENDER = 'LEGAREC <ne-pas-repondre@mail.legarec.fr>';
export interface AutomaticMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}
/** Implemented with Resend by the API; simulated in the tests. */
export interface AutomaticTransport {
  send(message: AutomaticMessage): Promise<void>;
}

/** Automatic e-mails of the kit, sent by Resend from an address that accepts no reply. */
export class EmailsService {
  constructor(
    private readonly renderer: EmailRenderer,
    private readonly transport: AutomaticTransport,
    private readonly config: EmailConfig,
  ) {}

  async send(name: AutomaticEmail, to: string, data: unknown): Promise<void> {
    const { subject, html } = this.renderer.renderAutomatic(name, data);
    await this.transport.send({
      from: AUTOMATIC_SENDER,
      to,
      subject,
      html,
      ...(REPLY_ACCEPTED.includes(name) ? { replyTo: this.config.collection_email } : {}),
    });
  }

  /** The role shown in an invitation always comes from the labels of the application. */
  async inviteStaff(to: string, role: Role, data: { first_name?: string; inviter: string; invitation_url: string; expires_in?: string }): Promise<void> {
    await this.send('staff-invitation', to, {
      recipient: { first_name: data.first_name },
      inviter: { name: data.inviter },
      role_label: ROLE_LABELS[role],
      requires_2fa: role === 'DEVELOPER',
      invitation_url: data.invitation_url,
      expires_in: data.expires_in,
    });
  }
}
