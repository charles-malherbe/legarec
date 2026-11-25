import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Column {
  type: string;
  nullable: boolean;
}
export interface PrismaSchema {
  tables: Record<string, Record<string, Column>>;
  keys: Record<string, string[]>;
  enums: Record<string, string[]>;
}

const NATIVE: Record<string, string> = { Uuid: 'uuid', Citext: 'citext', Date: 'date', Inet: 'inet' };
const SCALAR: Record<string, string> = { String: 'text', Int: 'integer', Boolean: 'boolean', Json: 'jsonb', Bytes: 'bytea' };
const mapped = (text: string) => /@{1,2}map\("([^"]+)"\)/u.exec(text)?.[1];

/** Tables, columns, keys and lists announced to the Prisma client: compared with the database, so that neither drifts. */
export function readPrismaSchema(directory: string): PrismaSchema {
  const text = readdirSync(directory)
    .filter((name) => name.endsWith('.prisma'))
    .map((name) => readFileSync(join(directory, name), 'utf8'))
    .join('\n');
  const blocks = [...text.matchAll(/^(model|enum) (\w+) \{\n([\s\S]*?)^\}/gmu)].map(([, kind = '', name = '', body = '']) => ({
    kind,
    name,
    lines: body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//')),
  }));
  const enumNames = new Map(blocks.filter((block) => block.kind === 'enum').map(({ name, lines }) => [name, lines.map(mapped).find(Boolean) ?? name]));
  const models = new Set(blocks.filter((block) => block.kind === 'model').map((block) => block.name));
  const schema: PrismaSchema = { tables: {}, keys: {}, enums: {} };
  for (const { kind, name, lines } of blocks) {
    if (kind === 'enum') {
      schema.enums[enumNames.get(name)!] = lines.filter((line) => !line.startsWith('@@'));
      continue;
    }
    const table = lines.filter((line) => line.startsWith('@@map')).map(mapped)[0] ?? name;
    const columns: Record<string, Column> = {};
    const columnOf = new Map<string, string>();
    let key: string[] = [];
    for (const line of lines.filter((entry) => !entry.startsWith('@@'))) {
      const [field = '', declared = ''] = line.split(/\s+/u);
      const base = declared.replace(/[?[\]]/gu, '');
      if (models.has(base)) continue;
      const column = mapped(line) ?? field;
      columnOf.set(field, column);
      const native = /@db\.(\w+)(?:\((\d+)\))?/u.exec(line);
      const type = native
        ? native[1] === 'Timestamptz'
          ? `timestamp(${native[2]}) with time zone`
          : (NATIVE[native[1]!] ?? `unknown ${native[1]}`)
        : (enumNames.get(base) ?? SCALAR[base] ?? `unknown ${base}`);
      columns[column] = { type, nullable: declared.endsWith('?') };
      if (/\s@id\b/u.test(line)) key = [column];
    }
    const composite = lines.map((line) => /^@@id\(\[([^\]]+)\]/u.exec(line)?.[1]).find(Boolean);
    if (composite) key = composite.split(',').map((field) => columnOf.get(field.trim())!);
    schema.tables[table] = columns;
    schema.keys[table] = key;
  }
  return schema;
}
