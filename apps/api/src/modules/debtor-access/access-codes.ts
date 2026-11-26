import { Inject, Injectable } from '@nestjs/common';
import { Audit } from '../../platform/audit/audit';
import { digest, type Binding } from '../../platform/crypto/keyring';
import { Database } from '../../platform/database/database';
import { conflict, forbidden, notFound } from '../../platform/errors/api-error';
import { LOGGER, type AppLogger } from '../../platform/logging/logger';
import { InternalKeys } from '../vault/internal-keys';
import { drawCode } from './codes';

export const bindingOf = (debtorId: string): Binding => ({ table: 'debtor_access_codes', id: debtorId, column: 'code_cipher' });
/** More draws than any debtor will ever have codes: beyond, something else is wrong. */
const DRAWS = 20;
interface Found {
  debtorId: string;
  /** Null when no key opens it: another one is drawn. */
  code: string | null;
  version: number;
}

/** The code of a debtor: in no log, no address, no queue and no stored text. */
@Injectable()
export class AccessCodes {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(InternalKeys) private readonly keys: InternalKeys,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(LOGGER) private readonly logger: AppLogger,
  ) {}

  /** In clear for whoever acts on the case, without a trace of it (question 21). */
  async show(caseId: string): Promise<{ code: string | null; version: number }> {
    await this.mayAct(caseId);
    const { code, version } = await this.ensure(caseId);
    return { code, version };
  }

  /** At the opening of a case: that of the debtor, drawn if they have none. */
  async ensure(caseId: string): Promise<Found> {
    const { tx } = this.database;
    const known = await this.find(caseId);
    if (known) return known;
    const owner = await tx.case.findUnique({ where: { id: caseId }, select: { debtorId: true } });
    if (!owner) throw notFound();
    const ring = await this.keys.ring('ACCESS_CODE_KEY');
    await tx.$executeRaw`SELECT app.first_access_code(${caseId}::uuid, ${ring.encrypt(drawCode(), bindingOf(owner.debtorId))})`;
    return (await this.find(caseId))!;
  }

  /** `seen`: the code that was on the screen. */
  async renew(caseId: string, seen: number): Promise<void> {
    await this.mayAct(caseId);
    const { debtorId, code: old, version } = await this.ensure(caseId);
    if (version !== seen) throw conflict('CHANGED');
    const ring = await this.keys.ring('ACCESS_CODE_KEY');
    const lookups = await this.keys.keys('LOOKUP_KEY');
    const digests = (code: string) => lookups.map((key) => digest(key, `access-code:${debtorId}:${code}`));
    for (let draw = 0; draw < DRAWS; draw += 1) {
      const code = drawCode();
      if (code === old) continue;
      const [row] = await this.database.tx.$queryRaw<{ done: boolean }[]>`
        SELECT app.renew_access_code(${caseId}::uuid, ${seen}::int, ${old === null ? null : digests(old)[0]!}::bytea, ${ring.encrypt(code, bindingOf(debtorId))}, ${digests(code)}) AS done`;
      if (!row!.done) continue;
      // The old code opens nothing more: its sessions close, and a block on any of its identifiers is lifted.
      await this.database.tx.$executeRaw`SELECT app.forget_debtor_access(${debtorId}::uuid)`;
      await this.audit.log({ action: 'ACCESS_CODE_RENEWED', entity: { type: 'case', id: caseId } });
      return;
    }
    throw conflict('CHANGED');
  }

  private async find(caseId: string): Promise<Found | null> {
    const [row] = await this.database.tx.$queryRaw<{ debtor_id: string; code_cipher: Uint8Array; version: number }[]>`
      SELECT debtor_id, code_cipher, version FROM app.access_code(${caseId}::uuid)`;
    if (!row) return null;
    const ring = await this.keys.ring('ACCESS_CODE_KEY');
    let code: string | null = null;
    try {
      code = ring.decrypt(row.code_cipher, bindingOf(row.debtor_id)).toString();
    } catch {
      this.logger.error('access code unreadable');
    }
    return { debtorId: row.debtor_id, version: row.version, code };
  }

  private async mayAct(caseId: string): Promise<void> {
    const [row] = await this.database.tx.$queryRaw<{ may: boolean; closed: boolean }[]>`
      SELECT app.can_act_on_case(officer_id) AS may, closed_on IS NOT NULL AS closed FROM cases WHERE id = ${caseId}::uuid`;
    if (!row) throw notFound();
    if (!row.may) throw forbidden();
    if (row.closed) throw conflict('CASE_CLOSED');
  }
}
