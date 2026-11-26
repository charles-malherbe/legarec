import { TEMPLATE_MAX_BYTES, type Session, type TemplateDetail } from '@legarec/contracts';
import {
  blockOf,
  renderPreview as render,
  slug,
  sourceOf,
  TEMPLATE_CATALOGUE as TEMPLATES,
  TEMPLATE_SAMPLES as SAMPLES,
  type StoredTemplate as Stored,
} from '@legarec/contracts/templateCatalogue';
import { checkTemplate } from '@legarec/contracts/templateCheck';
import { http, HttpResponse } from 'msw';
import { audit } from '../audit';
import { done, forbidden, guarded, notFound } from '../http';
import { administers } from './steering';

type Info = { request: Request; params: Record<string, unknown> };
type Progress = { status: TemplateDetail['status']; pending: TemplateDetail['pending']; by: string; bump: number };
let progress: Record<string, Progress> = {};
let cancelled: Record<string, Progress> = {};
export const resetTemplates = () => {
  cancelled = {};
  progress = {};
};
const staff = (session: Session) => session.role !== 'CREDITOR';
const imports = (session: Session) => session.role === 'DIRECTOR' || session.role === 'COLLECTION_MANAGER';
const detail = (item: Stored, session: Session): TemplateDetail => {
  const state = progress[item.id] ?? { status: 'PUBLISHED', pending: null, by: '', bump: 0 };
  const version = item.version + state.bump;
  const extension = item.kind === 'SMS' ? 'txt' : 'html';
  const { isReminder: _isReminder, ...shown } = item;
  return {
    ...shown,
    version,
    block: blockOf(item),
    status: state.status,
    pending: state.pending,
    fileName: `${slug(item.name)}-v${version}.${extension}`,
    fileSize: item.kind === 'SMS' ? '0,2 Ko' : item.kind === 'INVOICE' ? '7,8 Ko' : '6,4 Ko',
    source: sourceOf(item),
    canImport: imports(session),
    canValidate: administers(session),
    validator: session.activeDelegations.includes('ADMINISTRATIVE') ? 'Directeur, ou Responsable par délégation' : 'Directeur',
    samples: SAMPLES,
    versions: [
      { number: version, what: 'Version en service', who: `${item.author} · ${item.date} · validée par Marie Dubreuil`, state: 'PUBLISHED' },
      ...[1, 2]
        .filter((back) => version - back >= 1)
        .map((back) => ({
          number: version - back,
          what: back === 1 ? 'Délai de paiement passé de 15 à 8 jours' : 'Ajout du lien vers l’espace débiteur',
          who: back === 1 ? 'Hugo Benali · 14/08/2026' : `${item.author} · 02/05/2026`,
          state: 'ARCHIVED' as const,
        })),
    ],
  };
};
const onTemplate = (allow: (session: Session) => boolean, resolve: (item: Stored, session: Session, info: Info) => Response | Promise<Response>) =>
  guarded<Info>(allow, (info, session) => {
    const item = TEMPLATES.find((entry) => entry.id === info.params.id);
    return item ? resolve(item, session, info) : notFound();
  });

export const templateHandlers = [
  http.get(
    '/api/templates',
    guarded(staff, () =>
      HttpResponse.json({ items: TEMPLATES.map(({ id, name, channel, category, date, uses }) => ({ id, name, channel, category, date, uses })) }),
    ),
  ),
  http.get(
    '/api/templates/:id',
    onTemplate(staff, (item, session) => HttpResponse.json(detail(item, session))),
  ),
  http.post(
    '/api/templates/:id/import',
    onTemplate(imports, async (item, session, { request }) => {
      const { source, fileName } = (await request.json()) as { source: string; fileName: string };
      if (new Blob([source]).size > TEMPLATE_MAX_BYTES) return HttpResponse.json({ code: 'FILE_TOO_LARGE' }, { status: 413 });
      const report = checkTemplate({ ...item, block: blockOf(item) }, source);
      const pending = { fileName, accepted: report.accepted, checks: report.checks, previewHtml: report.accepted ? render(source) : '' };
      progress[item.id] = { status: report.accepted ? 'IMPORTED' : 'PUBLISHED', pending, by: session.userId, bump: progress[item.id]?.bump ?? 0 };
      return done();
    }),
  ),
  http.delete(
    '/api/templates/:id/import',
    onTemplate(imports, (item) => {
      const before = progress[item.id];
      if (before?.status === 'WAITING') return forbidden();
      if (before?.pending) cancelled[item.id] = before;
      progress[item.id] = { status: 'PUBLISHED', pending: null, by: '', bump: before?.bump ?? 0 };
      return done();
    }),
  ),
  // The API keeps the cancelled file for a while: « Annuler » works even after a reload.
  http.post(
    '/api/templates/:id/import/undo',
    onTemplate(imports, (item) => {
      const before = cancelled[item.id];
      if (!before) return notFound();
      progress[item.id] = before;
      delete cancelled[item.id];
      return done();
    }),
  ),
  http.post(
    '/api/templates/:id/restore',
    onTemplate(imports, (item, session) => {
      progress[item.id] = { status: 'RESTORED', pending: null, by: session.userId, bump: progress[item.id]?.bump ?? 0 };
      return done();
    }),
  ),
  http.post(
    '/api/templates/:id/submit',
    onTemplate(imports, async (item, _session, { request }) => {
      const state = progress[item.id];
      const { acknowledged } = (await request.json()) as { acknowledged: boolean };
      if (!state || state.status === 'PUBLISHED' || state.status === 'WAITING') return forbidden();
      if (state.pending?.checks.some((check) => check.level === 'WARNING') && !acknowledged) return HttpResponse.json({ code: 'WARNINGS' }, { status: 422 });
      state.status = 'WAITING';
      return done();
    }),
  ),
  http.post(
    '/api/templates/:id/review',
    onTemplate(administers, async (item, session, { request }) => {
      const state = progress[item.id];
      const { approved } = (await request.json()) as { approved: boolean };
      if (state?.status !== 'WAITING') return forbidden();
      audit(session, `Modèle « ${item.name} » ${approved ? 'publié' : 'refusé'}`, 'ADMINISTRATIVE');
      progress[item.id] = { status: 'PUBLISHED', pending: null, by: '', bump: state.bump + (approved ? 1 : 0) };
      return done();
    }),
  ),
  http.post(
    '/api/templates/:id/test',
    onTemplate(imports, () => done()),
  ),
];
