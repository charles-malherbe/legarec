import { TEMPLATE_MAX_BYTES, type TemplateCheck, type TemplateDetail, type templatesData } from '@legarec/contracts';
import { checkTemplate } from '@legarec/contracts/templateCheck';
import { blockOf, renderPreview, slug, sourceOf, TEMPLATE_CATALOGUE, TEMPLATE_SAMPLES, type StoredTemplate } from '@legarec/contracts/templateCatalogue';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { Database } from '../../platform/database/database';
import { ApiError, notFound } from '../../platform/errors/api-error';
import type { StaffActor } from '../cases/cases.service';

const date = (value: Date) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' }).format(value);
const size = (text: string) => `${(Buffer.byteLength(text) / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko`;
const fullName = (person: { firstName: string; lastName: string } | undefined) => (person ? `${person.firstName} ${person.lastName}` : '');
/** The words of a source, for the text shown beside it. */
const textOf = (source: string) =>
  source
    .replace(/\{\{>\s*\w+\s*\}\}/gu, '')
    .replace(/<\/p>\s*<p>/gu, '\n\n')
    .replace(/<br\s*\/?>/gu, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/\{\{\s*([\w.]+)\s*\}\}/gu, '{$1}')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .trim();

/** Templates of the firm: the catalogue, then the versions published here. PostgreSQL decides who changes what. */
@Injectable()
export class TemplatesService {
  constructor(@Inject(Database) private readonly database: Database) {}

  private item(id: string): StoredTemplate {
    const found = TEMPLATE_CATALOGUE.find((entry) => entry.id === id);
    if (!found) throw notFound();
    return found;
  }

  async list(): Promise<z.infer<typeof templatesData>> {
    const published = await this.database.tx.templateVersion.findMany({ where: { state: 'PUBLISHED' }, select: { templateCode: true, publishedAt: true } });
    return {
      items: TEMPLATE_CATALOGUE.map(({ id, name, channel, category }) => {
        const current = published.find((row) => row.templateCode === id);
        return { id, name, channel, category, date: current?.publishedAt ? date(current.publishedAt) : '—', uses: 0 };
      }),
    };
  }

  async detail(actor: StaffActor, id: string): Promise<TemplateDetail> {
    const item = this.item(id);
    const { tx } = this.database;
    const rows = await tx.templateVersion.findMany({
      where: { templateCode: id, state: { in: ['IMPORTED', 'RESTORED', 'WAITING', 'PUBLISHED', 'ARCHIVED'] } },
      orderBy: { createdAt: 'desc' },
      include: { importer: { select: { firstName: true, lastName: true } } },
    });
    const reviewers = new Map(
      (
        await tx.user.findMany({
          where: { id: { in: rows.flatMap((row) => (row.reviewedBy ? [row.reviewedBy] : [])) } },
          select: { id: true, firstName: true, lastName: true },
        })
      ).map((user) => [user.id, fullName(user)]),
    );
    const current = rows.find((row) => row.state === 'PUBLISHED');
    const pending = rows.find((row) => row.state === 'IMPORTED' || row.state === 'RESTORED' || row.state === 'WAITING');
    const source = current?.source ?? sourceOf(item);
    const version = current?.number ?? 1;
    const { isReminder: _isReminder, ...shown } = item;
    const [may] = await tx.$queryRaw<{ validates: boolean }[]>`SELECT app.acts_as_director('ADMINISTRATIVE') AS validates`;
    return {
      ...shown,
      body: current ? textOf(current.source) : item.body,
      version,
      date: current?.publishedAt ? date(current.publishedAt) : '—',
      author: current ? fullName(current.importer) : 'Legarec',
      uses: 0,
      block: blockOf(item),
      status: (pending?.state ?? 'PUBLISHED') as TemplateDetail['status'],
      pending: pending
        ? {
            fileName: pending.fileName,
            accepted: pending.accepted,
            checks: pending.checks as TemplateCheck[],
            previewHtml: pending.accepted ? renderPreview(pending.source) : '',
          }
        : null,
      fileName: `${slug(item.name)}-v${version}.${item.kind === 'SMS' ? 'txt' : 'html'}`,
      fileSize: size(source),
      source,
      canImport: actor.role === 'DIRECTOR' || actor.role === 'COLLECTION_MANAGER',
      canValidate: may?.validates === true,
      validator:
        actor.actingFor === 'ADMINISTRATIVE' || actor.delegations.includes('ADMINISTRATIVE') ? 'Directeur, ou Responsable par délégation' : 'Directeur',
      samples: TEMPLATE_SAMPLES,
      versions: [
        ...rows
          .filter((row) => row.number !== null)
          .map((row) => ({
            number: row.number!,
            what: row.state === 'PUBLISHED' ? 'Version en service' : 'Version archivée',
            who: `${fullName(row.importer)} · ${date(row.publishedAt!)}${row.reviewedBy ? ` · validée par ${reviewers.get(row.reviewedBy) ?? ''}` : ''}`,
            state: row.state === 'PUBLISHED' ? ('PUBLISHED' as const) : ('ARCHIVED' as const),
          })),
        {
          number: 1,
          what: current ? 'Version d’origine' : 'Version en service',
          who: 'Legarec',
          state: current ? ('ARCHIVED' as const) : ('PUBLISHED' as const),
        },
      ],
    };
  }

  /** Checked here (fields, mandatory block, scripts, external resources), then kept for the validation. */
  async import(id: string, source: string, fileName: string): Promise<void> {
    const item = this.item(id);
    if (Buffer.byteLength(source) > TEMPLATE_MAX_BYTES) throw new ApiError(413, 'FILE_TOO_LARGE');
    const report = checkTemplate({ ...item, block: blockOf(item) }, source);
    await this.database.tx.$executeRaw`SELECT app.import_template(${id}, ${source}, ${fileName.trim() || 'modele.html'}, ${report.accepted},
      ${JSON.stringify(report.checks)}::jsonb, ${report.checks.some((check) => check.level === 'WARNING')}, false)`;
  }

  async cancel(id: string, undo: boolean): Promise<void> {
    this.item(id);
    await this.database.tx.$executeRaw`SELECT app.cancel_template(${id}, ${undo})`;
  }

  /** A version of before comes back as a new one, checked again, then validated as any other. */
  async restore(id: string, number: number | undefined): Promise<void> {
    const item = this.item(id);
    const wanted = number ?? 1;
    let source: string;
    if (wanted === 1) source = sourceOf(item);
    else {
      const found = await this.database.tx.templateVersion.findFirst({ where: { templateCode: id, number: wanted }, select: { source: true } });
      if (!found) throw notFound();
      source = found.source;
    }
    const report = checkTemplate({ ...item, block: blockOf(item) }, source);
    await this.database.tx.$executeRaw`SELECT app.import_template(${id}, ${source}, ${`${slug(item.name)}-v${wanted}.${item.kind === 'SMS' ? 'txt' : 'html'}`},
      ${report.accepted}, ${JSON.stringify(report.checks)}::jsonb, ${report.checks.some((check) => check.level === 'WARNING')}, true)`;
  }

  async submit(id: string, acknowledged: boolean): Promise<void> {
    this.item(id);
    const pending = await this.database.tx.templateVersion.findFirst({ where: { templateCode: id, state: { in: ['IMPORTED', 'RESTORED'] } }, select: { hasWarnings: true } });
    // Read again by PostgreSQL, which refuses as well.
    if (pending?.hasWarnings && !acknowledged) throw new ApiError(422, 'WARNINGS');
    await this.database.tx.$executeRaw`SELECT app.submit_template(${id}, ${acknowledged})`;
  }

  async review(id: string, approved: boolean, reason: string | undefined): Promise<void> {
    this.item(id);
    await this.database.tx.$executeRaw`SELECT app.review_template(${id}, ${approved}, ${reason ?? ''})`;
  }
}
