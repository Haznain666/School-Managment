'use client';

import { DataTable, type DataTableColumn, type DataTableColumnKind } from '@/components/ui/DataTable';
import { TableCell, TableRow } from '@/components/ui/Table';
import {
  formatCell,
  isNumericKind,
  type ColumnKind,
  type ReportColumn,
  type ReportRow,
} from '@/lib/report-catalogue';

/**
 * A report's rows on screen: sortable, searchable and paged.
 *
 * ── Why this is separate from `ReportTable` ──────────────────────────────
 * The printed sheet must render every row, in the order the report defined,
 * with no controls on it — a paged printout is a printout missing pages, and a
 * sort control is ink. So the print path stays a server component and this one
 * is the client-side screen path. They share the *column declaration*, which is
 * the thing that must never diverge: neither file has a column list of its own.
 *
 * ── The sort is over the raw value, not the formatted cell ───────────────
 * `formatCell` turns 125000 into "1,25,000" and 0.9337 into "93.4%". Sorting
 * those as text puts "1,25,000" before "9,000" and is the exact defect the
 * type-aware comparator in `DataTable` exists to prevent. The comparator is
 * handed `row[column.key]` — the number the report produced.
 *
 * ── Filtering here does not change the totals ────────────────────────────
 * The footer is the report's own total for the filters in the URL, and it stays
 * put when the search box narrows what is on screen. That is deliberate and
 * labelled: the URL filters are the report, and this box is a way of finding a
 * row inside it.
 */

const KIND_MAP: Record<ColumnKind, DataTableColumnKind> = {
  text: 'text',
  number: 'number',
  money: 'money',
  percent: 'number',
  date: 'date',
};

export function ReportDataTable({
  title,
  columns,
  rows,
  totals,
}: {
  title: string;
  columns: readonly ReportColumn[];
  rows: readonly ReportRow[];
  totals: ReportRow | null;
}) {
  const tableColumns: Array<DataTableColumn<ReportRow>> = columns.map((column) => ({
    id: column.key,
    header: column.label,
    kind: KIND_MAP[column.kind],
    align: isNumericKind(column.kind) ? 'numeric' : 'start',
    muted: column.secondary === true,
    sortValue: (row) => row[column.key] ?? null,
    // Only the text columns join the search. A search box that matched digits
    // inside a money column would return rows for "50" that no reader could see
    // the reason for.
    searchValue:
      column.kind === 'text'
        ? (row) => String(row[column.key] ?? '')
        : undefined,
    cell: (row) => formatCell(column.kind, row[column.key] ?? null),
  }));

  return (
    <DataTable
      caption={title}
      columns={tableColumns}
      rows={rows}
      getRowKey={(_row, index) => String(index)}
      search={{ label: 'Find a row', placeholder: 'Search this report' }}
      itemNoun={{ singular: 'row', plural: 'rows' }}
      emptyTitle="Nothing to report"
      emptyDescription="Nothing matches the filters above. Widen the range and run it again."
      noResultTitle="No rows match that search"
      noResultDescription="The report itself is unchanged — clear the box to see every row again."
      footer={
        totals === null || rows.length === 0 ? undefined : (
          <TableRow>
            {columns.map((column) => (
              <TableCell
                key={column.key}
                align={isNumericKind(column.kind) ? 'numeric' : 'start'}
                className="font-semibold"
              >
                {formatCell(column.kind, totals[column.key] ?? null)}
              </TableCell>
            ))}
          </TableRow>
        )
      }
    />
  );
}
