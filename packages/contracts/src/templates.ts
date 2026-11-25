import { z } from 'zod';

export const templateKind = z.enum(['LETTER', 'EMAIL', 'SMS', 'INVOICE', 'CONTRACT']);
export const templateStatus = z.enum(['PUBLISHED', 'IMPORTED', 'RESTORED', 'WAITING']);
export const templateCheck = z.object({ level: z.enum(['OK', 'WARNING', 'ERROR']), label: z.string(), detail: z.string() });
export type TemplateCheck = z.infer<typeof templateCheck>;
export const templateImport = z.object({ fileName: z.string(), accepted: z.boolean(), checks: z.array(templateCheck), previewHtml: z.string() });
export type TemplateImport = z.infer<typeof templateImport>;
export const templateSummary = z.object({
  id: z.string(),
  name: z.string(),
  channel: z.string(),
  category: z.enum(['COLLECTION', 'BILLING']),
  date: z.string(),
  uses: z.number().int(),
});
export const templatesData = z.object({ items: z.array(templateSummary) });
export const templateDetail = templateSummary.extend({
  kind: templateKind,
  registered: z.boolean(),
  quote: z.boolean(),
  version: z.number().int(),
  author: z.string(),
  usedBy: z.string(),
  subject: z.string().nullable(),
  body: z.string(),
  lines: z.array(z.object({ label: z.string(), detail: z.string(), amount: z.string() })),
  totals: z.array(z.string()),
  fileName: z.string(),
  fileSize: z.string(),
  source: z.string(),
  block: z.string(),
  status: templateStatus,
  canImport: z.boolean(),
  canValidate: z.boolean(),
  validator: z.string(),
  pending: templateImport.nullable(),
  versions: z.array(z.object({ number: z.number().int(), what: z.string(), who: z.string(), state: z.enum(['PUBLISHED', 'ARCHIVED']) })),
  samples: z.array(z.object({ id: z.string(), label: z.string(), values: z.record(z.string(), z.string()) })),
});
export type TemplateDetail = z.infer<typeof templateDetail>;

/** 500 KB, as announced on the import screen. */
export const TEMPLATE_MAX_BYTES = 500_000;
