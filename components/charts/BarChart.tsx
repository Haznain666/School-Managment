import { ChartEmpty, ChartFrame, ChartLegend } from '@/components/charts/ChartFrame';
import { axisGutter, compactNumber, linearScale } from '@/lib/chart-scale';
import { cn } from '@/lib/utils';

/**
 * Bars — the workhorse of these dashboards.
 *
 * Covers monthly collection, class-wise strength, expected/collected/balance
 * and subject-wise averages, which between them are most of what Sprint 10.5's
 * visualisation table asks for. Grouped rather than stacked by default: the
 * comparison a school actually makes is "expected against collected", and a
 * stack answers "what do they total", which nobody asked.
 *
 * ── Two orientations, and what decides between them ──────────────────────
 * A vertical bar's category label gets `plotWidth / categories.length` to live
 * in, and that budget decides everything. Twelve months across 640 units is
 * ~48 units per label, which "Jan" fits and "Admissions & Enrolment" does not.
 * The module-adoption chart on the Super Admin dashboard drew eleven full
 * module names into ~54 units each, so every label overran its neighbours and
 * the axis became one unreadable smear of overlapping words.
 *
 * Rotating them trades overlap for a wall of diagonal text, and truncating them
 * renders "Academics & Timetable" and "Accounts & Finance" as the same string.
 * So `orientation="horizontal"` exists: categories run down the left edge,
 * where a label's budget is a fixed width that can simply be made wide enough,
 * and the bars grow rightwards. Long category names belong there. The caller
 * chooses, because only the caller knows how long its names are.
 *
 * Vertical remains the default and is unchanged — every other chart in this
 * product is a time series or a short-labelled comparison, which is what
 * vertical is for.
 */

export interface BarSeries {
  label: string;
  values: readonly number[];
  /** A Tailwind fill class. Defaults walk the `chart-*` ramp. */
  fillClass?: string;
  /**
   * A fill for individual bars, by category index. Anything absent falls back
   * to `fillClass`.
   *
   * ── What this is for, and the rule it must not break ─────────────────
   * One chart in this product ranks classes by attendance so the reader can
   * find the *worst* one, and a bar below the school's threshold is worth
   * marking. That is a difference in kind between bars in one series, which
   * `fillClass` cannot express.
   *
   * **Colour is never the only carrier.** The chart's `summary` names the
   * classes it has marked and the hidden data table carries every figure, so
   * the mark is a second signal on top of a stated fact rather than the fact
   * itself. Do not use this for a status nothing else on the screen states.
   */
  fillClasses?: readonly (string | undefined)[];
}

export interface BarChartProps {
  /** One label per group along the category axis. */
  categories: readonly string[];
  series: readonly BarSeries[];
  title: string;
  /** One sentence for screen readers: the trend, the headline, the range. */
  summary: string;
  /** Formats a value for the axis and the hidden table. */
  format?: (value: number) => string;
  /** Draws a legend. Defaults on when there is more than one series. */
  showLegend?: boolean;
  /**
   * Which way the bars run. `horizontal` puts the categories down the left
   * edge, and is the right choice whenever category names are words rather
   * than codes — see the docblock.
   */
  orientation?: 'vertical' | 'horizontal';
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

/*
 * Horizontal geometry. The height is computed from the row count rather than
 * fixed, so twenty categories produce a taller chart instead of twenty bars two
 * units thick. `left` is the label column and is the whole point of this mode.
 */
const H_PADDING = { top: 8, right: 40, bottom: 26, left: 172 };
/** One category's vertical budget, whatever the series count. */
const ROW_HEIGHT = 26;

/**
 * How many characters of a category name fit in the label column.
 *
 * ── The defect this exists for (Sprint 19a, item 5) ──────────────────────
 * The label is drawn at `axisX - 10` with `textAnchor="end"`, so it runs
 * *leftwards* from the axis into a 162-unit budget — and nothing clipped or
 * truncated it. `"Mid-Term Examination · Grade 5 - A"` on the dashboard's exam
 * outcomes chart ran off the left edge of the viewBox and printed over the
 * card beside it. SVG has no `text-overflow`, and a `clipPath` would cut a
 * word mid-letter with nothing to say it had; so the string is shortened here,
 * where a `…` can be added and the full text kept.
 *
 * 26 at 11px in 162 units. The ramp's glyphs average a little under 6 units
 * wide, so this is deliberately a character or two short of the arithmetic:
 * a label that just fits is a label that overlaps on the one school whose
 * campus is called "Muhammad Ali Jinnah Road".
 */
const H_LABEL_CHARS = 26;

/**
 * The category as the axis draws it, and the full string when it differs.
 *
 * **The chart may abbreviate; the accessible copy may not.** The hidden data
 * table and the `summary` both keep the untruncated name, and an `<title>` on
 * the truncated `<text>` answers a hover. A reader who cannot see the chart
 * still gets every name in full, which is the rule `ChartFrame` exists to
 * enforce and the one an abbreviation is most likely to break.
 */
function fitCategory(category: string): { shown: string; full: string | null } {
  if (category.length <= H_LABEL_CHARS) return { shown: category, full: null };
  // `- 1` for the ellipsis itself, and trailing space trimmed so the mark does
  // not float away from the word it belongs to.
  return {
    shown: `${category.slice(0, H_LABEL_CHARS - 1).trimEnd()}…`,
    full: category,
  };
}

export function BarChart({
  categories,
  series,
  title,
  summary,
  format = compactNumber,
  showLegend,
  orientation = 'vertical',
  className,
}: BarChartProps) {
  const hasData = categories.length > 0 && series.some((entry) => entry.values.length > 0);

  if (!hasData) {
    return <ChartEmpty message={`No data for ${title.toLowerCase()} yet.`} className={className} />;
  }

  const scale = linearScale(series.flatMap((entry) => [...entry.values]));
  const legendVisible = showLegend ?? series.length > 1;

  // Built once and handed to whichever branch renders: the accessible table and
  // the legend say the same thing in both orientations, and a second copy of
  // either is a second place for them to drift.
  const legend = legendVisible ? (
    <ChartLegend
      items={series.map((entry, index) => ({
        label: entry.label,
        swatchClass: SWATCHES[index % SWATCHES.length]!,
      }))}
    />
  ) : undefined;

  const dataTable = (
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
  );

  if (orientation === 'horizontal') {
    const plotWidth = WIDTH - H_PADDING.left - H_PADDING.right;
    const chartHeight = H_PADDING.top + categories.length * ROW_HEIGHT + H_PADDING.bottom;
    const axisX = H_PADDING.left;
    const axisBottom = H_PADDING.top + categories.length * ROW_HEIGHT;

    // A fifth of the row left as breathing space between categories, matching
    // the vertical chart's gap so the two read as one chart turned round.
    const barsHeight = ROW_HEIGHT * 0.8;
    const barHeight = barsHeight / series.length;

    return (
      <ChartFrame
        title={title}
        summary={summary}
        viewBox={`0 0 ${WIDTH} ${chartHeight}`}
        className={className}
        legend={legend}
        dataTable={dataTable}
      >
        <g aria-hidden="true">
          {scale.ticks.map((tick) => {
            const x = axisX + scale.ratio(tick) * plotWidth;
            return (
              <g key={tick}>
                <line
                  x1={x}
                  x2={x}
                  y1={H_PADDING.top}
                  y2={axisBottom}
                  className="stroke-[rgb(var(--ink)/0.10)]"
                  strokeWidth={1}
                />
                <text
                  x={x}
                  y={axisBottom + 14}
                  textAnchor="middle"
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
            const rowTop = H_PADDING.top + categoryIndex * ROW_HEIGHT;
            const barsTop = rowTop + (ROW_HEIGHT - barsHeight) / 2;
            const label = fitCategory(category);

            return (
              <g key={category}>
                {/*
                  Anchored to the end so labels run back from the axis. That
                  keeps every label's right edge aligned against the bars, which
                  is what makes the column scannable however long the names get
                  — and shortened to what the column holds, because "however
                  long" used to mean over the edge of the card. See
                  `fitCategory`.
                */}
                <text
                  x={axisX - 10}
                  y={rowTop + ROW_HEIGHT / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-[rgb(var(--ink-muted))] text-[11px]"
                >
                  {label.full === null ? null : <title>{label.full}</title>}
                  {label.shown}
                </text>

                {series.map((entry, seriesIndex) => {
                  const value = entry.values[categoryIndex] ?? 0;
                  // The same floor as the vertical chart: a small non-zero value
                  // must not round away into looking like no data at all.
                  const width = Math.max(
                    scale.ratio(value) * plotWidth,
                    value > 0 ? 1.5 : 0,
                  );

                  return (
                    <g key={entry.label}>
                      <rect
                        x={axisX}
                        y={barsTop + seriesIndex * barHeight}
                        width={width}
                        height={Math.max(1, barHeight - 2)}
                        rx={2}
                        className={cn(
                          entry.fillClasses?.[categoryIndex] ??
                            entry.fillClass ??
                            DEFAULT_FILLS[seriesIndex % DEFAULT_FILLS.length],
                        )}
                      />
                      {/*
                        The value printed past the end of its bar. A vertical
                        chart is read against its y axis; a horizontal one is
                        read row by row, and the figure is what the reader came
                        for. `H_PADDING.right` reserves the room for it.
                      */}
                      <text
                        x={axisX + width + 6}
                        y={barsTop + seriesIndex * barHeight + barHeight / 2}
                        dominantBaseline="middle"
                        className="fill-[rgb(var(--ink))] text-[11px] tabular-nums"
                      >
                        {format(value)}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>

        {/* The zero line, drawn last so bars do not sit on top of it. */}
        <line
          x1={axisX}
          x2={axisX}
          y1={H_PADDING.top}
          y2={axisBottom}
          className="stroke-[rgb(var(--border-strong))]"
          strokeWidth={1}
        />
      </ChartFrame>
    );
  }

  // The y-axis gutter is measured from the widest formatted tick rather
  // than assumed — see `axisGutter`. A money formatter needs more room
  // than `compactNumber`, and assuming otherwise drew outside the viewBox.
  const padLeft = axisGutter(scale.ticks, format);

  const plotWidth = WIDTH - padLeft - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const baseline = PADDING.top + plotHeight;

  const groupWidth = plotWidth / categories.length;
  // A gap of a fifth of the group, so bars breathe without the group losing its
  // identity as one category.
  const barsWidth = groupWidth * 0.8;
  const barWidth = barsWidth / series.length;

  return (
    <ChartFrame
      title={title}
      summary={summary}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={className}
      legend={legend}
      dataTable={dataTable}
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

      <g>
        {categories.map((category, categoryIndex) => {
          const groupX = padLeft + categoryIndex * groupWidth + (groupWidth - barsWidth) / 2;

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
                    className={cn(
                      entry.fillClasses?.[categoryIndex] ??
                        entry.fillClass ??
                        DEFAULT_FILLS[seriesIndex % DEFAULT_FILLS.length],
                    )}
                  />
                );
              })}

              <text
                x={padLeft + categoryIndex * groupWidth + groupWidth / 2}
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
