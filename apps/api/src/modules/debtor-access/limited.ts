import type { DebtorIdentifier, PaymentInfo } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../../platform/database/database';
import { ApiError } from '../../platform/errors/api-error';
import { RateLimits } from '../../platform/limits/rate-limits';
import { AuthKeys } from '../auth/keys';

const FIELDS = {
  holder: 'firm.cabinet.holder',
  iban: 'firm.cabinet.iban',
  bic: 'firm.cabinet.bic',
  payee: 'firm.cabinet.chequePayee',
  address: 'firm.cabinet.chequeAddress',
};
/** What the catalogue says until the Director types it: a value between brackets, which nothing sends. */
const DEFAULTS = {
  holder: '[TITULAIRE DU COMPTE]',
  iban: '[IBAN DU COMPTE DÉDIÉ]',
  bic: '[BIC]',
  payee: '[ORDRE DES CHÈQUES]',
  address: '[ADRESSE D’ENVOI DES CHÈQUES]',
};
const normalized = (identifier: DebtorIdentifier) =>
  identifier.kind === 'SIREN' ? identifier.value.replace(/\s/gu, '') : identifier.value.trim().toUpperCase();
const spaced = (siren: string) => siren.replace(/(\d{3})(\d{3})(\d{3})/u, '$1 $2 $3');

/** Before any code: the link of a letter, the code asked again, how to pay, a message to the firm. Nothing of any case. */
@Injectable()
export class LimitedSpace {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(AuthKeys) private readonly keys: AuthKeys,
    @Inject(RateLimits) private readonly limits: RateLimits,
  ) {}

  /** The identifier a link fills in; the same 404 for a link unknown, expired or of a closed case. */
  async link(token: string): Promise<{ identifier: { kind: 'SIREN' | 'REFERENCE'; value: string } }> {
    await this.limits.take({ name: 'debtor-link', max: 60, seconds: 3600 });
    if (!/^[A-Za-z0-9_-]{8,64}$/u.test(token)) throw new ApiError(404, 'UNKNOWN_LINK');
    const [row] = await this.database.tx.$queryRaw<{ kind: 'SIREN' | 'REFERENCE' | null; value: string | null }[]>`
      SELECT * FROM app.debtor_link(${this.keys.debtorLink(token)})`;
    if (!row?.kind || !row.value) throw new ApiError(404, 'UNKNOWN_LINK');
    return { identifier: { kind: row.kind, value: row.kind === 'SIREN' ? spaced(row.value) : row.value } };
  }

  /** Always the same answer; three an hour and five a day per identifier, twenty a day per network (question 114). */
  async codeBySms(identifier: DebtorIdentifier): Promise<{ requested: true }> {
    await this.limits.take({ name: 'debtor-sms-network', max: 20, seconds: 86_400 });
    const value = normalized(identifier);
    const asked = this.keys.attempt('debtor', `sms:${identifier.kind}:${value}`).toString('hex');
    await this.limits.take({ name: 'debtor-sms', max: 3, seconds: 3600 }, asked);
    // Whatever the networks: at most 5 texts a day towards one debtor (security review).
    await this.limits.take({ name: 'debtor-sms-day', max: 5, seconds: 86_400 }, asked);
    await this.database.tx.$executeRaw`SELECT app.ask_code_by_sms(${identifier.kind}, ${value})`;
    return { requested: true };
  }

  async payment(): Promise<PaymentInfo> {
    const rows = await this.database.tx.$queryRaw<{ key: string; value: unknown }[]>`SELECT * FROM app.firm_payment_settings()`;
    const value = (name: keyof typeof FIELDS) => {
      const found = rows.find((row) => row.key === FIELDS[name])?.value;
      return typeof found === 'string' && found ? found : DEFAULTS[name];
    };
    return {
      beneficiary: value('holder'),
      iban: value('iban'),
      bic: value('bic'),
      reference: null,
      chequeOrder: value('payee'),
      chequeAddress: value('address'),
    };
  }

  /** Ten an hour per network; no file without a code (the files of the space are those of a debtor signed in). */
  async message(body: { name: string; email: string; reference: string; text: string; attachments: unknown[] }): Promise<void> {
    await this.limits.take({ name: 'debtor-limited-message', max: 10, seconds: 3600 });
    if (body.attachments.length) throw new ApiError(422, 'INVALID', { fields: ['attachments'] });
    await this.database.tx.$executeRaw`SELECT app.limited_message(${body.name}, ${body.email}, ${body.reference}, ${body.text})`;
  }
}
