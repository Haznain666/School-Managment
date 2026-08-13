import { ChartEmpty, ChartFrame, ChartLegend } from '@/components/charts/ChartFrame';
import { compactNumber, linearScale } from '@/lib/chart-scale';
import { cn } from '@/lib/utils';

/**
 * Bars — the workhorse of these dashboards.
 *
 * Covers monthly collection, class-wise strength, expected/collected/balance
 * and subject-wise averages, which between them are most of what Sprint 10.5's
 * visualisation table asks for. Grouped rather than stacked by default: the
 * comparison a school actually makes is "expected against collected", and a
 * stack answers "what do they total", which nobody asked.
 */

export interface BarSeries {
  label: string;
  values: readonly number[];
  /** A Tailwind fill class. Defaults walk the `chart-*` ramp. */
  fillClass?: string;
}

export interface BarChartProps {
  /** One label per group along the x axis. */
  categories: readonly string[];
  series: readonly BarSeries[];
  title: string;
  /** One sentence for screen readers: the trend, the headline, the range. */
  summary: string;
  /** Formats a value for the axis and the hidden table. */
  format?: (value: number) => string;
  /** Draws a legend. Defaults on when there is more than one series. */
  showLegend?: boolean;
  className?: string;
}

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

/* Chart geometry, in viewBox units. */
const WIDTH = 640;
const HEIGHT = 260;
const PADDING = { top: 12, right: 8, bottom: 30, left: 46 };

export function BarChart({
  categories,
  series,
  title,
  summary,
  format = compactNumber,
  showLegend,
  className,
}: BarChartProps) {
  const hasData = categories.length > 0 && series.some((entry) => entry.values.length > 0);

  if (!hasData) {
    return <ChartEmpty message={`No data for ${title.toLowerCase()} yet.`} className={className} />;
  }

  const scale = linearScale(series.flatMap((entry) => [...entry.values]));

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const baseline = PADDING.top + plotHeight;

  const groupWidth = plotWidth / categories.length;
  // A gap of a fifth of the group, so bars breathe without the group losing its
  // identity as one category.
  const barsWidth = groupWidth * 0.8;
  const barWidth = barsWidth / series.length;

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
              <th scope="col">Category</th>
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
                {series.map((entry) => (
                  <td key={entry.label}>
                    {entry.values[index] === undefined ? '—' : format(entry.values[index]!)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {/*
        Gridlines behind everything, drawn from the ink at low alpha rather than
        a fixed grey, so they stay correctly weighted on a dark school palette
        as well as a light one.
      */}
      <g aria-hidden="true">
        {scale.ticks.map((tick) => {
          const y = baseline - scale.ratio(tick) * plotHeight;
          return (
            <g key={tick}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={y}
                y2={y}
                className="stroke-[rgb(var(--ink)/0.10)]"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 8}
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

      <g>
        {categories.map((category, categoryIndex) => {
          const groupX = PADDING.left + categoryIndex * groupWidth + (groupWidth - barsWidth) / 2;

          return (
            <g key={category}>
              {series.map((entry, seriesIndex) => {
                const value = entry.values[categoryIndex] ?? 0;
                const height = Math.max(0, scale.ratio(value) * plotHeight);

                return (
                  <rect
                    key={entry.label}
                    x={groupX + seriesIndex * barWidth}
                    // A floor of 1.5 units so a small but non-zero value is
                    // still visible. A bar that rounds to nothing reads as "no
                    // data", which is a different and much worse statement than
                    // "very little".
                    y={baseline - Math.max(height, value > 0 ? 1.5 : 0)}
                    width={Math.max(1, barWidth - 2)}
                    height={Math.max(height, value > 0 ? 1.5 : 0)}
                    rx={2}
                    className={cn(entry.fillClass ?? DEFAULT_FILLS[seriesIndex % DEFAULT_FILLS.length])}
                  />
                );
              })}

              <text
                x={PADDING.left + categoryIndex * groupWidth + groupWidth / 2}
                y={baseline + 16}
                textAnchor="middle"
                className="fill-[rgb(var(--ink-muted))] text-[11px]"
              >
                {category}
              </text>
            </g>
          );
        })}
      </g>

      {/* The zero line, drawn last so bars do not sit on top of it. */}
      <line
        x1={PADDING.left}
        x2={WIDTH - PADDING.right}
        y1={baseline}
        y2={baseline}
        className="stroke-[rgb(var(--border-strong))]"
        strokeWidth={1}
      />
    </ChartFrame>
  );
}
