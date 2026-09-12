import type { ReactNode } from 'react';

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
 *
 * ── Two drawings: one for a phone ────────────────────────────────────────
 * The same reason as `BarChart`'s: a 640-unit drawing in a ~300px card sets
 * the axis at ~5px. The chart draws again at `PHONE` width and `ChartFrame`
 * shows one by breakpoint. The x-axis labels are thinned against their
 * *measured* width in each drawing, so the narrower one shows fewer of them
 * rather than overlapping them.
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

/** What every line chart has always drawn, and still draws from `sm` up. */
const DESKTOP = { width: 640, height: 260 };
/** Below `sm` — `BarChart`'s phone geometry, for the same reasons. */
const PHONE = { width: 320, height: 220 };
const PADDING = { top: 12, right: 12, bottom: 30 };

/**
 * Units per glyph of the 11px axis label, for thinning. `BarChart`'s measured
 * figure rather than `axisGutter`'s 5.6: short capitalised labels like "Jan"
 * render at ~6.3 units a glyph, and an estimate that is too narrow keeps labels
 * that touch.
 */
const GLYPH_WIDTH = 6.4;
/** Space kept between two neighbouring labels — ~5px on a phone. */
const LABEL_GAP = 6;

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

  const showArea = area && series.length === 1;
  const legendVisible = showLegend ?? series.length > 1;
  const last = categories.length - 1;

  function draw(geometry: { width: number; height: number }): {
    viewBox: string;
    content: ReactNode;
  } {
    const plotWidth = geometry.width - padLeft - PADDING.right;
    const plotHeight = geometry.height - PADDING.top - PADDING.bottom;
    const baseline = PADDING.top + plotHeight;

    // A single point has no span to divide by; centre it rather than dividing by
    // zero and drawing it off the left edge.
    const stepX = categories.length > 1 ? plotWidth / (categories.length - 1) : 0;
    const xFor = (index: number) =>
      categories.length > 1 ? padLeft + index * stepX : padLeft + plotWidth / 2;
    const yFor = (value: number) => baseline - scale.ratio(value) * plotHeight;

    /*
     * Thin out the labels rather than rotating them. Rotated labels are harder
     * to read and eat the vertical space the chart itself needs.
     *
     * The stride is the larger of "about six labels" — what this axis has
     * always drawn — and what the widest label actually needs at this
     * drawing's spacing, which is the one that decides on a phone.
     *
     * The stride assumes two centred labels, and the edges are not centred:
     * the first is anchored at its start and reaches half a label further
     * right, the last at its end and half a label further left. So a label is
     * kept only when it is at least a stride past the previous kept one *and*
     * clears it — on a phone "Jan 2026" and "Apr 2026" touched until this
     * checked the neighbour — and never when it would touch the final period,
     * which is the label a reader of a trend most needs.
     */
    const widestLabel =
      categories.reduce((max, category) => Math.max(max, category.length), 0) * GLYPH_WIDTH;
    const stride = Math.max(
      Math.ceil(categories.length / 6),
      stepX > 0 ? Math.ceil((widestLabel + LABEL_GAP) / stepX) : 1,
    );

    const anchorFor = (index: number) =>
      index === 0 ? 'start' : index === last ? 'end' : 'middle';
    const extentOf = (index: number): [number, number] => {
      const width = categories[index]!.length * GLYPH_WIDTH;
      const x = xFor(index);
      const anchor = anchorFor(index);
      return anchor === 'start' ? [x, x + width] : anchor === 'end' ? [x - width, x] : [x - width / 2, x + width / 2];
    };

    const labelled = new Set<number>([last]);
    const lastLeft = extentOf(last)[0];
    let previous = -1;
    for (let index = 0; index < last; index += 1) {
      if (previous >= 0 && index - previous < stride) continue;
      const [left, right] = extentOf(index);
      const clearsPrevious = previous < 0 || left >= extentOf(previous)[1] + LABEL_GAP;
      if (clearsPrevious && right + LABEL_GAP <= lastLeft) {
        labelled.add(index);
        previous = index;
      }
    }

    return {
      viewBox: `0 0 ${geometry.width} ${geometry.height}`,
      content: (
        <>
          <g aria-hidden="true">
            {scale.ticks.map((tick) => {
              const y = yFor(tick);
              return (
                <g key={tick}>
                  <line
                    x1={padLeft}
                    x2={geometry.width - PADDING.right}
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
             * A null breaks the line into separate runs rather than being
             * bridged. A month with no register taken is not a straight line
             * between its neighbours, and drawing one invents data.
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

            const strokeClass =
              entry.strokeClass ?? DEFAULT_STROKES[seriesIndex % DEFAULT_STROKES.length]!;
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
            {categories.map((category, index) =>
              labelled.has(index) ? (
                <text
                  key={category}
                  x={xFor(index)}
                  y={baseline + 16}
                  textAnchor={anchorFor(index)}
                  className="fill-[rgb(var(--ink-muted))] text-[11px]"
                >
                  {category}
                </text>
              ) : null,
            )}
          </g>

          <line
            x1={padLeft}
            x2={geometry.width - PADDING.right}
            y1={baseline}
            y2={baseline}
            className="stroke-[rgb(var(--border-strong))]"
            strokeWidth={1}
          />
        </>
      ),
    };
  }

  const desktop = draw(DESKTOP);
  const phone = draw(PHONE);

  return (
    <ChartFrame
      title={title}
      summary={summary}
      viewBox={desktop.viewBox}
      phone={phone}
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
      {desktop.content}
    </ChartFrame>
  );
}
