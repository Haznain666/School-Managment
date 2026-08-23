import {
  formatCell,
  isNumericKind,
  type ReportDefinition,
  type ReportRow,
} from '@/lib/report-catalogue';
import { ReportDataTable } from '@/components/reports/ReportDataTable';

/**
 * A report's rows, drawn from its column declaration.
 *
 * The same component serves the screen and the printed sheet — `variant`
 * changes the styling, never the columns. That is deliberate: a printout that
 * shows different columns from the screen it was printed from is the defect
 * this sprint's whole one-definition-three-renderers shape exists to prevent,
 * and it would be reintroduced the moment the print page got a column list of
 * its own.
 *
 * `secondary` columns are the exception, and only on paper. A9 landscape has a
 * finite width, and a campus name or an employee code dropped from a printed
 * sheet costs nothing a reader needs — the alternative is a table that reflows
 * into unreadable slivers. The screen shows every column.
 *
 * ── Sprint 15: the screen half moved, the print half did not ─────────────
 * Sorting, searching and paging belong on screen and nowhere near a printout,
 * so the screen path now delegates to `ReportDataTable` — a client component —
 * while the printed sheet stays exactly what it was: a server-rendered table of
 * every row, in the report's own order. Both still read `definition.columns`,
 * which is the part that was never allowed to diverge.
 */
export function ReportTable({
  definition,
  rows,
  totals,
  variant = 'screen',
}: {
  definition: ReportDefinition;
  rows: readonly ReportRow[];
  totals: ReportRow | null;
  variant?: 'screen' | 'print';
}) {
  const columns =
    variant === 'print'
      ? definition.columns.filter((column) => column.secondary !== true)
      : definition.columns;

  if (variant === 'print') {
    return (
      <table className="w-full border-collapse text-[9px]">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`border border-black px-1 py-0.5 font-semibold ${
                  isNumericKind(column.kind) ? 'text-right' : 'text-left'
                }`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`border border-black px-1 py-0.5 ${
                    isNumericKind(column.kind) ? 'text-right tabular-nums' : 'text-left'
                  }`}
                >
                  {formatCell(column.kind, row[column.key] ?? null)}
                </td>
              ))}
            </tr>
          ))}
          {totals === null ? null : (
            <tr className="font-bold">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`border border-black px-1 py-0.5 ${
                    isNumericKind(column.kind) ? 'text-right tabular-nums' : 'text-left'
                  }`}
                >
                  {formatCell(column.kind, totals[column.key] ?? null)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    );
  }

  return (
    <ReportDataTable
      title={definition.title}
      columns={columns}
      rows={rows}
      totals={totals}
    />
  );
}
