import {
  formatCell,
  isNumericKind,
  type ReportDefinition,
  type ReportRow,
} from '@/lib/report-catalogue';
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableFoot,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';

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
    <Table caption={definition.title}>
      <TableHead>
        <TableRow>
          {columns.map((column) => (
            <TableHeaderCell
              key={column.key}
              align={isNumericKind(column.kind) ? 'numeric' : 'start'}
            >
              {column.label}
            </TableHeaderCell>
          ))}
        </TableRow>
      </TableHead>

      <TableBody>
        {rows.length === 0 ? (
          <TableEmptyRow colSpan={columns.length}>
            Nothing to report under those filters.
          </TableEmptyRow>
        ) : (
          rows.map((row, index) => (
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  align={isNumericKind(column.kind) ? 'numeric' : 'start'}
                  muted={column.secondary === true}
                >
                  {formatCell(column.kind, row[column.key] ?? null)}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>

      {totals === null || rows.length === 0 ? null : (
        <TableFoot>
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
        </TableFoot>
      )}
    </Table>
  );
}
