import { emailSchemas, staffMessage, type AutomaticEmail, type EmailConfig, type StaffMessageData } from '@legarec/contracts';
import Handlebars from 'handlebars';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATES_DIR = fileURLToPath(new URL('../../templates/emails/', import.meta.url));
export interface RenderedEmail {
  subject: string;
  html: string;
}

/** A header must stay on one line: no header can be injected through a subject. */
const oneLine = (value: string) => value.replace(/[\r\n]+/gu, ' ').trim();

/** Renders the kit with the real handlebars library, exactly as its README describes. */
export class EmailRenderer {
  private readonly engine = Handlebars.create();
  private readonly subjects: Record<string, string>;
  private readonly bodies = new Map<string, Handlebars.TemplateDelegate>();

  constructor(
    private readonly config: EmailConfig,
    private readonly dir = TEMPLATES_DIR,
  ) {
    const read = (file: string) => readFileSync(join(dir, file), 'utf8');
    this.engine.registerPartial('layout', read('layout.hbs'));
    for (const file of readdirSync(join(dir, 'partials'))) this.engine.registerPartial(basename(file, '.hbs'), read(join('partials', file)));
    this.subjects = JSON.parse(read('subjects.json')) as Record<string, string>;
  }

  renderAutomatic(name: AutomaticEmail, data: unknown): RenderedEmail {
    // The schema drops every unknown key: only the reminders declare `case.access_code`.
    const context = { ...emailSchemas[name].parse(data), config: this.config };
    const source = this.subjects[name];
    if (!source) throw new Error(`No subject for ${name}`);
    const subject = oneLine(this.engine.compile(source, { noEscape: true })(context));
    return { subject, html: this.body(name)({ ...context, subject }) };
  }

  renderStaffMessage(data: StaffMessageData): RenderedEmail {
    const parsed = staffMessage.parse(data);
    const subject = oneLine(parsed.message.subject);
    return { subject, html: this.body('staff-message')({ ...parsed, config: this.config, subject }) };
  }

  private body(name: string): Handlebars.TemplateDelegate {
    const known = this.bodies.get(name);
    if (known) return known;
    const compiled = this.engine.compile(readFileSync(join(this.dir, 'templates', `${name}.hbs`), 'utf8'));
    this.bodies.set(name, compiled);
    return compiled;
  }
}
