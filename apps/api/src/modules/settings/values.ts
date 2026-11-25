import { firmGroups, technicalGroups, type SettingDefinition, type SettingGroup } from '@legarec/contracts';
import type { Transaction } from '../../platform/database/database';

export type Scope = 'firm' | 'technical';
export type Value = string | boolean;
const GROUPS: Record<Scope, () => SettingGroup[]> = { firm: firmGroups, technical: technicalGroups };
const keyOf = (scope: Scope, section: string, field: string) => `${scope}.${section}.${field}`;

/** Settings as they are now: the catalogue, and what the firm has changed. */
export class SettingValues {
  private constructor(private readonly changed: ReadonlyMap<string, Value>) {}

  static async read(tx: Transaction): Promise<SettingValues> {
    const rows = await tx.setting.findMany({ select: { key: true, value: true } });
    return new SettingValues(new Map(rows.map(({ key, value }) => [key, value as Value])));
  }

  groups(scope: Scope): SettingGroup[] {
    return GROUPS[scope]().map((group) => ({ ...group, items: group.items.map((item) => this.filled(scope, item)) }));
  }

  section(scope: Scope, id: string): SettingDefinition | undefined {
    return this.groups(scope)
      .flatMap((group) => group.items)
      .find((item) => item.id === id);
  }

  text(scope: Scope, section: string, field: string): string {
    return (
      this.section(scope, section)
        ?.blocks.flatMap((block) => block.fields)
        .find((item) => item.id === field)?.value ?? ''
    );
  }

  /** A value removed from a list since it was chosen is the one of the catalogue again: the strictest reading of what was written. */
  private filled(scope: Scope, item: SettingDefinition): SettingDefinition {
    return {
      ...item,
      blocks: item.blocks.map((block) => ({
        ...block,
        fields: block.fields.map((field) => {
          const value = this.changed.get(keyOf(scope, item.id, field.id));
          if (value === undefined || field.locked || field.kind === 'value') return field;
          if (typeof value === 'boolean') return field.kind === 'switch' ? { ...field, checked: value } : field;
          if (field.kind === 'switch' || (field.kind === 'select' && !field.options.includes(value))) return field;
          return { ...field, value };
        }),
      })),
    };
  }
}
export { keyOf };
