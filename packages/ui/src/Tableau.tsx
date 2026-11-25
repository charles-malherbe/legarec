import { Table } from '@mantine/core';
import {
  createSortedRowModel,
  rowSelectionFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowSelectionState,
} from '@tanstack/react-table';
import { useMemo, type ReactNode } from 'react';
import { Badge } from './Badge';
import { Case } from './Case';
import { EtatListe, type EtatListeProps } from './EtatListe';
import { Icone } from './Icone';
import { Statut } from './Statut';
import css from './Tableau.module.css';
import type { LayoutProps, Tone } from './types';

export interface CellValue {
  text: string;
  sub?: string;
  tone?: Tone;
  strong?: boolean;
  mono?: boolean;
  type?: 'text' | 'badge' | 'status';
}
export interface TableauColumn<Row> {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  type?: 'text' | 'badge' | 'status';
  /** Simple cell; use `render` for rich ones. */
  value?: (row: Row) => CellValue | string;
  render?: (row: Row) => ReactNode;
  /** Enables sorting on that column. */
  sortValue?: (row: Row) => string | number;
}
export interface TableauProps<Row> extends LayoutProps {
  columns: TableauColumn<Row>[];
  rows: Row[];
  rowId: (row: Row) => string;
  caption?: string;
  hideCaption?: boolean;
  sticky?: boolean;
  bordered?: boolean;
  dense?: boolean;
  state?: Pick<EtatListeProps, 'kind' | 'title' | 'text' | 'actionLabel' | 'onAction'>;
  emptyTitle?: string;
  activeRowId?: string;
  onRow?: (row: Row) => void;
  rowLabel?: (row: Row) => string;
  selection?: { selected: string[]; onChange: (ids: string[]) => void };
}

const features = tableFeatures({ rowSortingFeature, rowSelectionFeature, sortedRowModel: createSortedRowModel(), sortFns });

export function Tableau<Row extends object>(props: TableauProps<Row>) {
  const { columns, rows, rowId, selection, onRow, state } = props;
  const defs = useMemo<ColumnDef<typeof features, Row>[]>(
    () =>
      columns.map((column) => ({
        id: column.key,
        header: column.label,
        accessorFn: (row: Row) => column.sortValue?.(row) ?? '',
        enableSorting: !!column.sortValue,
      })),
    [columns],
  );
  const rowSelection: RowSelectionState = Object.fromEntries((selection?.selected ?? []).map((id) => [id, true]));
  const table = useTable({
    features,
    columns: defs,
    data: rows,
    getRowId: rowId,
    state: { rowSelection },
    onRowSelectionChange: (updater) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater;
      selection?.onChange(Object.keys(next).filter((id) => next[id]));
    },
  });
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const body = table.getRowModel().rows;
  const empty = rows.length === 0 || !!state;

  return (
    <div
      data-table-scroll={props.sticky === false ? undefined : ''}
      className={css.root}
      data-bordered={props.bordered !== false || undefined}
      data-dense={props.dense || undefined}
      style={props.layout}
    >
      <Table unstyled className={css.table}>
        {props.caption && <caption className={props.hideCaption ? css.hidden : css.caption}>{props.caption}</caption>}
        <thead>
          <tr>
            {selection && (
              <th scope="col" className={css.check}>
                <Case
                  hideLabel
                  label="Tout sélectionner"
                  checked={table.getIsAllRowsSelected()}
                  indeterminate={table.getIsSomeRowsSelected()}
                  onToggle={(next) => table.toggleAllRowsSelected(next)}
                />
              </th>
            )}
            {table.getFlatHeaders().map((header) => {
              const column = byKey.get(header.column.id);
              const sorted = header.column.getIsSorted();
              return (
                <th
                  key={header.id}
                  scope="col"
                  style={{ width: column?.width }}
                  data-align={column?.align}
                  aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {column?.sortValue ? (
                    <button type="button" className={css.sort} onClick={header.column.getToggleSortingHandler()}>
                      {column.label}
                      <Icone icon={sorted ? 'chevron-down' : 'selector'} size={12} layout={sorted === 'asc' ? { transform: 'rotate(180deg)' } : undefined} />
                    </button>
                  ) : (
                    column?.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        {!empty && (
          <tbody>
            {body.map((row) => (
              <tr
                key={row.id}
                data-active={row.id === props.activeRowId || undefined}
                data-clickable={onRow ? true : undefined}
                onClick={onRow ? () => onRow(row.original) : undefined}
              >
                {selection && (
                  <td className={css.check} onClick={(event) => event.stopPropagation()}>
                    <Case
                      hideLabel
                      label={`Sélectionner ${props.rowLabel?.(row.original) ?? row.id}`}
                      checked={row.getIsSelected()}
                      onToggle={(next) => row.toggleSelected(next)}
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td key={column.key} data-align={column.align}>
                    {column.render ? column.render(row.original) : <Cell value={column.value?.(row.original) ?? '—'} type={column.type} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        )}
      </Table>
      {empty && (state ? <EtatListe compact {...state} /> : <EtatListe kind="empty" title={props.emptyTitle ?? 'Aucun élément'} compact />)}
    </div>
  );
}

function Cell({ value, type = 'text' }: { value: CellValue | string; type?: CellValue['type'] }) {
  const cell = typeof value === 'string' ? { text: value } : value;
  const kind = cell.type ?? type;
  if (kind === 'badge') return <Badge label={cell.text} tone={cell.tone} />;
  if (kind === 'status') return <Statut label={cell.text} tone={cell.tone} />;
  return (
    <span className={css.cell}>
      <span className={css.value} data-strong={cell.strong || undefined} data-mono={cell.mono || undefined}>
        {cell.text}
      </span>
      {cell.sub && <span className={css.sub}>{cell.sub}</span>}
    </span>
  );
}
