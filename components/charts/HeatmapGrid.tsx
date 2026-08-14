import { ChartEmpty, ChartFrame } from '@/components/charts/ChartFrame';
import { cn } from '@/lib/utils';

/**
 * A calendar grid shaded by intensity — the monthly attendance heatmap.
 *
 * ── Why the shading is opacity of one colour, not a rainbow ──────────────
 * A sequential quantity wants a sequential ramp: one hue, varying in lightness.
 * The reflex alternative — green for good, red for bad through amber — is a
 * *diverging* scale, and it implies a meaningful midpoint that attendance does
 * not have. It also collapses for the 8% of men with a red-green deficiency,
 * on a grid where the whole message is carried by colour.
 *
 * So intensity is opacity over the school's own primary. That inherits the
 * palette for free, works in greyscale when printed, and reads correctly for
 * everyone.
 *
 * ── Absence is not zero ──────────────────────────────────────────────────
 * A day with no register taken is drawn as an empty outlined cell, not as a
 * pale one. Shading a holiday as "very low attendance" would make every term
 * break look like a crisis.
 */

export interface HeatmapCell {
  /** Column position, 0-based. */
  column: number;
  /** Row position, 0-based. */
  row: number;
  /** `null` means no observation — a holiday, a day before the term began. */
  value: number | null;
  /** What this cell is, for the hidden table: "Mon 3 March". */
  label: string;
}

export interface HeatmapGridProps {
  cells: readonly HeatmapCell[];
  /** Column headings — week numbers, or month names. */
  columnLabels: readonly string[];
  /** Row headings — weekday names, or class names. */
  rowLabels: readonly string[];
  title: string;
  summary: string;
  /** The value that counts as full intensity. Defaults to the highest present. */
  maxValue?: number;
  format?: (value: number) => string;
  className?: string;
}

const CELL = 18;
const GAP = 3;
const ROW_LABEL_WIDTH = 34;
const COLUMN_LABEL_HEIGHT = 16;

export function HeatmapGrid({
  cells,
  columnLabels,
  rowLabels,
  title,
  summary,
  maxValue,
  format = (value) => `${Math.round(value)}%`,
  className,
}: HeatmapGridProps) {
  const observed = cells
    .map((cell) => cell.value)
    .filter((value): value is number => value !== null);

  if (cells.length === 0 || observed.length === 0) {
    return <ChartEmpty message={`No data for ${title.toLowerCase()} yet.`} className={className} />;
  }

  const ceiling = maxValue ?? Math.max(...observed);

  const width = ROW_LABEL_WIDTH + columnLabels.length * (CELL + GAP);
  const height = COLUMN_LABEL_HEIGHT + rowLabels.length * (CELL + GAP);

  return (
    <ChartFrame
      title={title}
      summary={summary}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      legend={<HeatmapLegend format={format} ceiling={ceiling} />}
      dataTable={
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((cell, index) => (
              <tr key={`${cell.label}-${index}`}>
                <th scope="row">{cell.label}</th>
                <td>{cell.value === null ? 'No data' : format(cell.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <g aria-hidden="true">
        {columnLabels.map((label, index) => (
          <text
            key={`${label}-${index}`}
            x={ROW_LABEL_WIDTH + index * (CELL + GAP) + CELL / 2}
            y={COLUMN_LABEL_HEIGHT - 6}
            textAnchor="middle"
            className="fill-[rgb(var(--ink-muted))] text-[9px]"
          >
            {label}
          </text>
        ))}

        {rowLabels.map((label, index) => (
          <text
            key={`${label}-${index}`}
            x={ROW_LABEL_WIDTH - 6}
            y={COLUMN_LABEL_HEIGHT + index * (CELL + GAP) + CELL / 2}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-[rgb(var(--ink-muted))] text-[9px]"
          >
            {label}
          </text>
        ))}
      </g>

      {cells.map((cell, index) => {
        const x = ROW_LABEL_WIDTH + cell.column * (CELL + GAP);
        const y = COLUMN_LABEL_HEIGHT + cell.row * (CELL + GAP);

        if (cell.value === null) {
          return (
            <rect
              key={index}
              x={x}
              y={y}
              width={CELL}
              height={CELL}
              rx={3}
              fill="none"
              className="stroke-[rgb(var(--border))]"
              strokeWidth={1}
            />
          );
        }

        /*
         * A floor of 0.12 rather than a true zero: a cell that was observed and
         * came back at 0% must still be visibly a *cell*, distinct from the
         * outlined "no data" square beside it. Those two states mean opposite
         * things — "nobody came" versus "nobody looked".
         */
        const intensity = 0.12 + 0.88 * Math.min(1, Math.max(0, cell.value / (ceiling || 1)));

        return (
          <rect
            key={index}
            x={x}
            y={y}
            width={CELL}
            height={CELL}
            rx={3}
            fill={`rgb(var(--brand-primary) / ${intensity.toFixed(2)})`}
          >
            {/* Native tooltip: free, works on the server, no JS. */}
            <title>{`${cell.label}: ${format(cell.value)}`}</title>
          </rect>
        );
      })}
    </ChartFrame>
  );
}

function HeatmapLegend({
  format,
  ceiling,
}: {
  format: (value: number) => string;
  ceiling: number;
}) {
  const steps = [0.12, 0.34, 0.56, 0.78, 1];

  return (
    <div aria-hidden="true" className="flex items-center gap-2 text-2xs text-ink-muted">
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-sm border border-line" />
        No data
      </span>

      <span className="ml-auto flex items-center gap-1">
        <span>0</span>
        {steps.map((step) => (
          <span
            key={step}
            className={cn('h-2.5 w-2.5 rounded-sm')}
            style={{ backgroundColor: `rgb(var(--brand-primary) / ${step})` }}
          />
        ))}
        <span>{format(ceiling)}</span>
      </span>
    </div>
  );
}
