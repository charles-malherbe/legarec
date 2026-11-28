import type { AutomaticEmail } from '@legarec/contracts';
import type { AutomaticMessage, EmailsService } from '../../emails/emails.service';
import { allowedOutsideProduction, ProviderRefused, type ResendClient } from '../../emails/resend';
import { GiveUp, TryLater } from '../../platform/queue/errors';
import type { Run } from '../../platform/queue/jobs';
import type { Vault } from '../vault/vault';

export interface AccountMailParts {
  /** The rights of the worker: the key is read by them alone. */
  asWorker: Run;
  vault: Pick<Vault, 'open'>;
  emails: Pick<EmailsService, 'compose'>;
  resend: ResendClient;
  /** In production, a missing key makes the e-mail wait; elsewhere it is simulated and nothing leaves the machine. */
  production: boolean;
  /** `RESEND_ENV=production`, said in so many words: without it, a key only writes to the test addresses. */
  real: boolean;
  /** Addresses of the firm a test key may write to, outside production. */
  devRecipients: readonly string[];
  /** What a simulated e-mail does with the message (a private folder in development, a list in the tests). */
  simulate(message: AutomaticMessage): Promise<void>;
}

/** Sends the message once it is written: given only after the checks, so that a link is drawn for an e-mail that may leave. */
export type Deliver = (name: AutomaticEmail, data: unknown) => Promise<void>;
/** Asked before the link is drawn: refuses, or says the message may now be written. `once` is the identifier of the task. */
export type AccountMail = (to: string, once: string) => Promise<Deliver>;

/**
 * E-mails of the accounts by Resend, with the key and the domain of the reminders (question 217). Neither the address, nor
 * the link, nor the key, nor what Resend answers is logged or thrown: only a code.
 */
export function accountMail({ asWorker, vault, emails, resend, production, real, devRecipients, simulate }: AccountMailParts): AccountMail {
  return async (to, once) => {
    const [stored] = await asWorker(
      (tx) => tx.$queryRaw<{ id: string | null; value_cipher: Uint8Array | null }[]>`SELECT * FROM app.service_key('RESEND_API_KEY')`,
    );
    const key = stored?.id && stored.value_cipher ? vault.open(stored.id, stored.value_cipher) : null;
    // Nothing has been drawn yet: the task waits for the key, as long as it takes.
    if (!key && production) throw new TryLater('NO_KEY');
    if (key && !real && !allowedOutsideProduction(to, devRecipients)) throw new GiveUp('DEV_RECIPIENT');
    return async (name, data) => {
      let message: AutomaticMessage;
      try {
        message = await emails.compose(name, to, data);
      } catch {
        // What the template refuses may quote the address or the link.
        throw new GiveUp('UNREADABLE_MESSAGE');
      }
      if (!key) return simulate(message);
      try {
        await resend.send(key, message, `account/${once}`);
      } catch (error) {
        if (error instanceof ProviderRefused) throw new GiveUp(error.code);
        // Nothing clear came back: perhaps it has left. Never sent again, the person asks for another one.
        throw new GiveUp('UNCERTAIN');
      }
    };
  };
}
