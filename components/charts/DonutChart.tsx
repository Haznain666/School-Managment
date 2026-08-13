import { ChartEmpty, ChartFrame, ChartLegend } from '@/components/charts/ChartFrame';
import { donutSegment } from '@/lib/chart-scale';
import { cn } from '@/lib/utils';

/**
 * A proportion: collected against outstanding against overdue, a child's
 * attendance ring, the split of an admissions funnel.
 *
 * ── When this is the right chart, and when it is not ─────────────────────
 * A donut answers "how is this one total divided", and only that. It is used
 * here for two or three slices at most; beyond that the segments get too small
 * to compare and a bar chart is strictly better, because comparing lengths is
 * something people do accurately and comparing angles is not.
 *
 * The hole is what makes it a donut rather than a pie, and it earns its place:
 * the middle carries the headline figure. A parent looking at their child's
 * attendance ring wants "94%", and the ring is the context for that number
 * rather than the thing being read.
 */

export interface DonutSlice {
  label: string;
  value: number;
  /** Tailwind fill class. Defaults walk the `chart-*` ramp. */
  fillClass?: string;
}

export interface DonutChartProps {
  slices: readonly DonutSlice[];
  title: string;
  summary: string;
  /** The figure in the hole — usually a percentage or the total. */
  centerValue?: string;
  /** A word under it: "attendance", "collected". */
  centerLabel?: string;
  format?: (value: number) => string;
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

const SWATCH_FOR_FILL: Record<string, string> = {
  'fill-chart-1': 'bg-chart-1',
  'fill-chart-2': 'bg-chart-2',
  'fill-chart-3': 'bg-chart-3',
  'fill-chart-4': 'bg-chart-4',
  'fill-chart-5': 'bg-chart-5',
  'fill-chart-6': 'bg-chart-6',
  'fill-status-success': 'bg-status-success',
  'fill-status-warning': 'bg-status-warning',
  'fill-status-danger': 'bg-status-danger',
  'fill-status-info': 'bg-status-info',
};

const SIZE = 200;
const CENTER = SIZE / 2;
const OUTER = 88;
const INNER = 60;

export function DonutChart({
  slices,
  title,
  summary,
  centerValue,
  centerLabel,
  format = (value) => value.toLocaleString(),
  showLegend = true,
  className,
}: DonutChartProps) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);

  if (slices.length === 0 || total === 0) {
    return <ChartEmpty message={`No data for ${title.toLowerCase()} yet.`} className={className} />;
  }

  const resolved = slices.map((slice, index) => ({
    ...slice,
    fill: slice.fillClass ?? DEFAULT_FILLS[index % DEFAULT_FILLS.length]!,
    fraction: Math.max(0, slice.value) / total,
  }));

  let cursor = 0;

  return (
    <ChartFrame
      title={title}
      summary={summary}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={cn('mx-auto max-w-[220px]', className)}
      legend={
        showLegend ? (
          <ChartLegend
            className="justify-center"
            items={resolved.map((slice) => ({
              label: slice.label,
              swatchClass: SWATCH_FOR_FILL[slice.fill] ?? 'bg-chart-1',
              value: format(slice.value),
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
              <th scope="col">Value</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {resolved.map((slice) => (
              <tr key={slice.label}>
                <th scope="row">{slice.label}</th>
                <td>{format(slice.value)}</td>
                <td>{(slice.fraction * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {/*
        The track behind the segments. Without it a donut that does not sum to
        its own total — an attendance ring at 94% — has nothing to be 94% *of*,
        and reads as a broken shape rather than a partial one.
      */}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={(OUTER + INNER) / 2}
        fill="none"
        strokeWidth={OUTER - INNER}
        className="stroke-[rgb(var(--surface-sunken))]"
      />

      {resolved.map((slice) => {
        const start = cursor;
        cursor += slice.fraction;

        return (
          <path
            key={slice.label}
            d={donutSegment(CENTER, CENTER, OUTER, INNER, start, cursor)}
            className={slice.fill}
            // A hairline in the page colour between segments, so two adjacent
            // slices of similar hue still read as two.
            stroke="rgb(var(--surface-raised))"
            strokeWidth={1.5}
          />
        );
      })}

      {centerValue !== undefined ? (
        <text
          x={CENTER}
          y={centerLabel === undefined ? CENTER : CENTER - 6}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-[rgb(var(--ink))] text-[26px] font-semibold tabular-nums"
        >
          {centerValue}
        </text>
      ) : null}

      {centerLabel !== undefined ? (
        <text
          x={CENTER}
          y={CENTER + 16}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-[rgb(var(--ink-muted))] text-[11px]"
        >
          {centerLabel}
        </text>
      ) : null}
    </ChartFrame>
  );
}
