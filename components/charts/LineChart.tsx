import { ChartEmpty, ChartFrame, ChartLegend } from '@/components/charts/ChartFrame';
import {
  areaPath,
  axisGutter,
  compactNumber,
  linearScale,
  smoothPath,
  type Point,
} from '@/lib/chart-scale';
import { cn } from '@/lib/utils';

/**
 * A trend over time: attendance rate by week, collection by month, a student's
 * result across terms.
 *
 * ── Points are always marked ─────────────────────────────────────────────
 * Every observation gets a dot, not just the line through them. These series
 * are short — twelve months, six terms — and with so few points the line
 * between them is an interpolation the reader should be able to see past. A
 * bare line implies continuous measurement; this data is monthly snapshots.
 *
 * ── The area fill is optional and single-series only ─────────────────────
 * Stacked translucent areas are the standard way this kind of chart becomes
 * unreadable: overlapping fills produce colours that are in neither series and
 * a reader cannot tell which is on top. With two or more series this draws
 * lines alone.
 */

export interface LineSeries {
  label: string;
  /** One value per point on the x axis. `null` is a genuine gap, not a zero. */
  values: readonly (number | null)[];
  /** Tailwind stroke class. Defaults walk the `chart-*` ramp. */
  strokeClass?: string;
}

export interface LineChartProps {
  /** One label per x position — months, terms, weeks. */
  categories: readonly string[];
  series: readonly LineSeries[];
  title: string;
  summary: string;
  format?: (value: number) => string;
  /** Fills under the line. Ignored when there is more than one series. */
  area?: boolean;
  showLegend?: boolean;
  className?: string;
}

const DEFAULT_STROKES = [
  'stroke-chart-1',
  'stroke-chart-2',
  'stroke-chart-3',
  'stroke-chart-4',
  'stroke-chart-5',
  'stroke-chart-6',
] as const;

const DEFAULT_FILLS = [
  'fill-chart-1',
  'fill-chart-2',
  'fill-chart-3',
  'fill-chart-4',
  'fill-chart-5',
  'fill-chart-6',
] as const;

const SWATCHES = [
  'bg-chart-1',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-5',
  'bg-chart-6',
] as const;

const WIDTH = 640;
const HEIGHT = 260;
const PADDING = { top: 12, right: 12, bottom: 30, left: 46 };

export function LineChart({
  categories,
  series,
  title,
  summary,
  format = compactNumber,
  area = false,
  showLegend,
  className,
}: LineChartProps) {
  const allValues = series.flatMap((entry) =>
    entry.values.filter((value): value is number => value !== null),
  );

  if (categories.length === 0 || allValues.length === 0) {
    return <ChartEmpty message={`No data for ${title.toLowerCase()} yet.`} className={className} />;
  }

  const scale = linearScale(allValues);

  // The y-axis gutter is measured from the widest formatted tick rather
  // than assumed — see `axisGutter`. A money formatter needs more room
  // than `compactNumber`, and assuming otherwise drew outside the viewBox.
  const padLeft = axisGutter(scale.ticks, format);

  const plotWidth = WIDTH - padLeft - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const baseline = PADDING.top + plotHeight;

  // A single point has no span to divide by; centre it rather than dividing by
  // zero and drawing it off the left edge.
  const stepX = categories.length > 1 ? plotWidth / (categories.length - 1) : 0;
  const xFor = (index: number) =>
    categories.length > 1 ? padLeft + index * stepX : padLeft + plotWidth / 2;
  const yFor = (value: number) => baseline - scale.ratio(value) * plotHeight;

  const showArea = area && series.length === 1;
  const legendVisible = showLegend ?? series.length > 1;

  return (
    <ChartFrame
      title={title}
      summary={summary}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={className}
      legend={
        legendVisible ? (
          <ChartLegend
            items={series.map((entry, index) => ({
              label: entry.label,
              swatchClass: SWATCHES[index % SWATCHES.length]!,
            }))}
          />
        ) : undefined
      }
      dataTable={
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              {series.map((entry) => (
                <th key={entry.label} scope="col">
                  {entry.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category, index) => (
              <tr key={category}>
                <th scope="row">{category}</th>
                {series.map((entry) => {
                  const value = entry.values[index];
                  return (
                    <td key={entry.label}>
                      {value === null || value === undefined ? 'No data' : format(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <g aria-hidden="true">
        {scale.ticks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                x2={WIDTH - PADDING.right}
                y1={y}
                y2={y}
                className="stroke-[rgb(var(--ink)/0.10)]"
                strokeWidth={1}
              />
              <text
                x={padLeft - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-[rgb(var(--ink-muted))] text-[11px] tabular-nums"
              >
                {format(tick)}
              </text>
            </g>
          );
        })}
      </g>

      {series.map((entry, seriesIndex) => {
        /*
         * A null breaks the line into separate runs rather than being bridged.
         * A month with no register taken is not a straight line between its
         * neighbours, and drawing one invents data.
         */
        const runs: Point[][] = [];
        let run: Point[] = [];

        entry.values.forEach((value, index) => {
          if (value === null) {
            if (run.length > 0) runs.push(run);
            run = [];
            return;
          }
          run.push({ x: xFor(index), y: yFor(value) });
        });
        if (run.length > 0) runs.push(run);

        const strokeClass = entry.strokeClass ?? DEFAULT_STROKES[seriesIndex % DEFAULT_STROKES.length]!;
        const fillClass = DEFAULT_FILLS[seriesIndex % DEFAULT_FILLS.length]!;

        return (
          <g key={entry.label}>
            {showArea
              ? runs.map((points, index) => (
                  <path
                    key={`area-${index}`}
                    d={areaPath(points, baseline)}
                    className={cn(fillClass, 'opacity-10')}
                  />
                ))
              : null}

            {runs.map((points, index) =>
              // A run of one point has no line to draw; the dot below carries it.
              points.length > 1 ? (
                <path
                  key={`line-${index}`}
                  d={smoothPath(points)}
                  fill="none"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={strokeClass}
                />
              ) : null,
            )}

            {runs.flat().map((point, index) => (
              <circle
                key={`dot-${index}`}
                cx={point.x}
                cy={point.y}
                r={3}
                // Ringed in the page colour so a dot stays legible where it
                // crosses a gridline or another series.
                className={cn(fillClass, 'stroke-[rgb(var(--surface-raised))]')}
                strokeWidth={2}
              />
            ))}
          </g>
        );
      })}

      <g aria-hidden="true">
        {categories.map((category, index) => {
          /*
           * Thin out the labels rather than rotating them. A twelve-month axis
           * at this width fits about six labels; rotated labels are harder to
           * read and eat the vertical space the chart itself needs.
           */
          const stride = Math.ceil(categories.length / 6);
          if (index % stride !== 0 && index !== categories.length - 1) return null;

          return (
            <text
              key={category}
              x={xFor(index)}
              y={baseline + 16}
              textAnchor={
                index === 0 ? 'start' : index === categories.length - 1 ? 'end' : 'middle'
              }
              className="fill-[rgb(var(--ink-muted))] text-[11px]"
            >
              {category}
            </text>
          );
        })}
      </g>

      <line
        x1={padLeft}
        x2={WIDTH - PADDING.right}
        y1={baseline}
        y2={baseline}
        className="stroke-[rgb(var(--border-strong))]"
        strokeWidth={1}
      />
    </ChartFrame>
  );
}
