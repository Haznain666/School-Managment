import type { ReactNode } from 'react';

import { ChartEmpty, ChartFrame, ChartLegend } from '@/components/charts/ChartFrame';
import { axisGutter, compactNumber, linearScale, valueGutter } from '@/lib/chart-scale';
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
 * ~48 units per label, which "Jan" fits and "Admissions & Enrollment" does not.
 * The module-adoption chart on the Super Admin dashboard drew eleven full
 * module names into ~54 units each, so every label overran its neighbours and
 * the axis became one unreadable smear of overlapping words.
 *
 * Rotating them trades overlap for a wall of diagonal text, and truncating them
 * renders "Academics & Timetable" and "Accounts & Finance" as the same string.
 * So `orientation="horizontal"` exists: categories run down the left edge,
 * where a label's budget is a fixed width that can simply be made wide enough,
 * and the bars grow rightwards. Long category names belong there. The caller
 * chooses, because only the caller knows how long its names are — and a
 * vertical chart whose labels would overlap anyway is drawn horizontally.
 *
 * ── Two drawings: one for a phone ────────────────────────────────────────
 * The SVG scales its viewBox to its container, so a 640-unit drawing in a
 * ~300px phone card sets every 11-unit label at ~5px. Nothing overlaps and
 * nothing can be read. So the chart draws twice — `DESKTOP` and `PHONE`
 * geometry — and `ChartFrame` shows exactly one by CSS breakpoint. The phone
 * drawing is half the width, which puts the same 11-unit label at ~10px.
 *
 * Half the width is also half the label budget, so the orientation is decided
 * **per drawing**. A handful of grade bands still stand up on a phone; twelve
 * month names and five ageing buckets called "Over 90 days" do not, and turn on
 * their side on a phone only — a row per month, every one of them labelled.
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
   *
   * `vertical` is a preference, not a promise: when the labels cannot fit
   * their bars without overlapping, the chart is drawn horizontally anyway —
   * decided separately for the desktop and the phone drawing.
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

/**
 * One drawing's coordinate space.
 *
 * `height` is a vertical chart's; a horizontal one grows with its rows.
 * `labelColumn` is the horizontal chart's left gutter, and `labelChars` how
 * much of a category name that column holds — see `fitCategory`.
 */
interface Geometry {
  width: number;
  height: number;
  labelColumn: number;
  labelChars: number;
}

/**
 * What every chart has always drawn, and still draws from `sm` up.
 *
 * `labelChars` 26 at 11px in a 162-unit budget (`labelColumn - 10`). The ramp's
 * glyphs average a little under 6 units wide, so this is deliberately a
 * character or two short of the arithmetic: a label that just fits is a label
 * that overlaps on the one school whose campus is called "Muhammad Ali Jinnah
 * Road".
 */
const DESKTOP: Geometry = { width: 640, height: 260, labelColumn: 172, labelChars: 26 };

/**
 * Below `sm`. 320 units in a ~300px card sets an 11-unit label at ~10px.
 *
 * 220 tall rather than 130 (half of 260): a phone has height to spare and not
 * width, and a plot squashed to the same aspect as the desktop would draw a
 * 12-month bar chart ~120px tall. The label column keeps 106 units for text —
 * sixteen characters, which every class name at Askari fits ("Pre-Nursery A"
 * is thirteen).
 */
const PHONE: Geometry = { width: 320, height: 220, labelColumn: 116, labelChars: 16 };

/* Vertical padding, in viewBox units. `left` is measured — see `axisGutter`. */
const PADDING = { top: 12, right: 8, bottom: 30 };

/*
 * Horizontal padding. The height is computed from the row count rather than
 * fixed, so twenty categories produce a taller chart instead of twenty bars two
 * units thick. `left` is the geometry's label column and is the whole point of
 * this mode.
 *
 * `right` is **measured** rather than taken from here — see `valueGutter` and
 * item 2b. The constant survives only as the floor that keeps every
 * compact-formatted chart drawing exactly what it drew before.
 */
const H_PADDING = { top: 8, right: 40, bottom: 26 };

/**
 * What a bar's value label reads when the value is exactly zero.
 *
 * ── Item 2a, and it is about the campus charts specifically ──────────────
 * `PKR 0` printed twice, stacked, against a campus with no activity is four
 * characters of noise in the place a reader is scanning for a figure. A dash is
 * the conventional accounting nil and takes a quarter of the width.
 *
 * Two things deliberately keep the real number. The **axis ticks** do, because
 * an axis is a scale and a scale with a dash on it is broken. And the hidden
 * accessible table and the `summary` do, because a screen reader must not be
 * told a school collected a dash — it collected nothing, which is a figure.
 */
const ZERO_LABEL = '—';
/** One category's vertical budget when it has one series. */
const ROW_HEIGHT = 26;

/**
 * The height a bar's value label needs, in units — a 10px label measured
 * 12.8 tall. Each series in a horizontal row gets at least this much.
 *
 * ── The defect this exists for ────────────────────────────────────────
 * The row was a fixed 26 units whatever the series count, so two series got
 * 10.4 each and their value labels overlapped by 2.4 units — "10.2L" printed
 * into "8.7L" on every row. It had been doing that on the desktop dashboard's
 * *Recent exam outcomes* (pass rate and average) since that chart went
 * horizontal; a phone drawing of *Collection by month* is what made it visible.
 */
const VALUE_LINE_HEIGHT = 13;

/**
 * Units per glyph of an 11px category label, for deciding whether labels fit.
 *
 * **Measured, and deliberately wider than `axisGutter`'s 5.6.** 5.6 is the
 * average over long mixed strings like `PKR 20,000`. Category labels are
 * short and capitalised, and those run wider: rendered in Chromium, "Jan … Dec"
 * averaged 6.28 units a glyph and "A* … U" 7.19. At 5.6 twelve months passed
 * as fitting a phone and were drawn 1px apart — touching, on screen, while
 * every assertion said they did not overlap.
 */
const VERTICAL_GLYPH_WIDTH = 6.4;
/** Units per glyph of the 10px tick and value labels — `valueGutter`'s figure. */
const SMALL_GLYPH_WIDTH = 5.2;
/** Space kept between two neighbouring labels — ~5px on a phone. */
const LABEL_GAP = 6;

/**
 * The category as the axis draws it, and the full string when it differs.
 *
 * ── The defect this exists for (Sprint 19a, item 5) ──────────────────────
 * The label is drawn at `axisX - 10` with `textAnchor="end"`, so it runs
 * *leftwards* from the axis into the label column — and nothing clipped or
 * truncated it. `"Mid-Term Examination · Grade 5 - A"` on the dashboard's exam
 * outcomes chart ran off the left edge of the viewBox and printed over the
 * card beside it. SVG has no `text-overflow`, and a `clipPath` would cut a
 * word mid-letter with nothing to say it had; so the string is shortened here,
 * where a `…` can be added and the full text kept.
 *
 * **The chart may abbreviate; the accessible copy may not.** The hidden data
 * table and the `summary` both keep the untruncated name, and an `<title>` on
 * the truncated `<text>` answers a hover. A reader who cannot see the chart
 * still gets every name in full, which is the rule `ChartFrame` exists to
 * enforce and the one an abbreviation is most likely to break.
 */
function fitCategory(category: string, maxChars: number): { shown: string; full: string | null } {
  if (category.length <= maxChars) return { shown: category, full: null };
  // `- 1` for the ellipsis itself, and trailing space trimmed so the mark does
  // not float away from the word it belongs to.
  return {
    shown: `${category.slice(0, maxChars - 1).trimEnd()}…`,
    full: category,
  };
}

interface Drawing {
  viewBox: string;
  content: ReactNode;
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

  // The y-axis gutter is measured from the widest formatted tick rather
  // than assumed — see `axisGutter`. A money formatter needs more room
  // than `compactNumber`, and assuming otherwise drew outside the viewBox.
  const padLeft = axisGutter(scale.ticks, format);

  /*
   * ── A vertical chart whose labels cannot fit is drawn horizontally ─────
   * The docblock's rule, enforced here instead of remembered at each call site.
   * *Attendance by class* on the attendance reports screen drew twenty-nine
   * section names into ~20 units each at Askari, and the axis read
   * "Pre-NurseryNurseryBNurseryPrep A…" — the module-adoption smear again, on a
   * caller that had never been told about it.
   *
   * Measured at `VERTICAL_GLYPH_WIDTH` per glyph plus `LABEL_GAP`, so two labels
   * that nearly meet still read as two words. Asked of each geometry: a chart
   * that fits the desktop drawing may not fit the phone one.
   */
  const widestLabel = categories.reduce((max, category) => Math.max(max, category.length), 0);
  const labelsOverlap = (geometry: Geometry) =>
    widestLabel * VERTICAL_GLYPH_WIDTH + LABEL_GAP >
    (geometry.width - padLeft - PADDING.right) / categories.length;

  // Built once and handed to the frame: the accessible table and the legend say
  // the same thing whichever drawing is on screen, and a second copy of either
  // is a second place for them to drift.
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

  function drawHorizontal(geometry: Geometry): Drawing {
    /*
     * The right gutter, measured against the **widest value that will actually
     * be drawn** — not against the ticks, which are a rounded scale and are
     * routinely narrower than the figures under them. Item 2b: this was a
     * hard-coded 40, and `PKR 20,000` at 10px needs ~52, so the last glyph of
     * every long label was drawn outside the viewBox and clipped.
     *
     * A zero draws `ZERO_LABEL`, which is one glyph, so it cannot widen the
     * gutter — but a series of nothing but zeroes still gets the floor.
     */
    const padRight = valueGutter(
      series.flatMap((entry) => [...entry.values]).filter((value) => value !== 0),
      format,
      H_PADDING.right,
    );

    // 26 for one series, as always; taller when several share a row, so each
    // series' value label has `VALUE_LINE_HEIGHT` to itself. `/ 0.8` because
    // the bars occupy four fifths of the row.
    const rowHeight = Math.max(ROW_HEIGHT, Math.ceil((series.length * VALUE_LINE_HEIGHT) / 0.8));
    const plotWidth = geometry.width - geometry.labelColumn - padRight;
    const chartHeight = H_PADDING.top + categories.length * rowHeight + H_PADDING.bottom;
    const axisX = geometry.labelColumn;
    const axisBottom = H_PADDING.top + categories.length * rowHeight;

    // A fifth of the row left as breathing space between categories, matching
    // the vertical chart's gap so the two read as one chart turned round.
    const barsHeight = rowHeight * 0.8;
    const barHeight = barsHeight / series.length;

    /*
     * Tick labels share one baseline, so on a narrow plot they can collide —
     * `PKR 20,000` is ~52 units and the phone drawing spaces five ticks ~40
     * apart. Every gridline is kept; only the labels are thinned, to every
     * `tickStride`th. On the desktop drawing this is 1 for every chart that
     * exists.
     */
    const tickSpacing =
      scale.ticks.length > 1 ? plotWidth / (scale.ticks.length - 1) : plotWidth;
    const widestTick =
      scale.ticks.reduce((max, tick) => Math.max(max, format(tick).length), 0) *
        SMALL_GLYPH_WIDTH +
      LABEL_GAP;
    const tickStride = Math.max(1, Math.ceil(widestTick / tickSpacing));

    return {
      viewBox: `0 0 ${geometry.width} ${chartHeight}`,
      content: (
        <>
          <g aria-hidden="true">
            {scale.ticks.map((tick, tickIndex) => {
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
                  {/*
                    The tick keeps the real figure, `PKR 0` included. An axis is
                    a scale; a scale with a dash on it is broken. Item 2a is about
                    the per-bar figure and only that.
                  */}
                  {tickIndex % tickStride === 0 ? (
                    <text
                      x={x}
                      y={axisBottom + 14}
                      textAnchor="middle"
                      className="fill-[rgb(var(--ink-muted))] text-[10px] tabular-nums"
                    >
                      {format(tick)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>

          <g>
            {categories.map((category, categoryIndex) => {
              const rowTop = H_PADDING.top + categoryIndex * rowHeight;
              const barsTop = rowTop + (rowHeight - barsHeight) / 2;
              const label = fitCategory(category, geometry.labelChars);

              return (
                <g key={category}>
                  {/*
                    Anchored to the end so labels run back from the axis. That
                    keeps every label's right edge aligned against the bars, which
                    is what makes the column scannable however long the names get
                    — and shortened to what the column holds, because "however
                    long" used to mean over the edge of the card. See
                    `fitCategory`.

                    Item 2c. The category is the *row's name* — the thing a reader
                    scans down the edge to find the campus they are worried about
                    — so it takes full ink; the ticks keep the muted tone.
                  */}
                  <text
                    x={axisX - 10}
                    y={rowTop + rowHeight / 2}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-[rgb(var(--ink))] text-[11px]"
                  >
                    {label.full === null ? null : <title>{label.full}</title>}
                    {label.shown}
                  </text>

                  {series.map((entry, seriesIndex) => {
                    const value = entry.values[categoryIndex] ?? 0;
                    // The same floor as the vertical chart: a small non-zero value
                    // must not round away into looking like no data at all.
                    const width = Math.max(scale.ratio(value) * plotWidth, value > 0 ? 1.5 : 0);

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
                          for. `padRight` — measured, not assumed — reserves the
                          room for it.

                          A zero prints a dash in the faint ink instead (item 2a).
                          The accessible table still carries the real `PKR 0`.
                        */}
                        <text
                          x={axisX + width + 6}
                          y={barsTop + seriesIndex * barHeight + barHeight / 2}
                          dominantBaseline="middle"
                          className={cn(
                            'text-[10px] font-semibold tabular-nums',
                            value === 0
                              ? 'fill-[rgb(var(--ink-faint))]'
                              : 'fill-[rgb(var(--ink))]',
                          )}
                        >
                          {value === 0 ? ZERO_LABEL : format(value)}
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
        </>
      ),
    };
  }

  function drawVertical(geometry: Geometry): Drawing {
    const plotWidth = geometry.width - padLeft - PADDING.right;
    const plotHeight = geometry.height - PADDING.top - PADDING.bottom;
    const baseline = PADDING.top + plotHeight;

    const groupWidth = plotWidth / categories.length;
    // A gap of a fifth of the group, so bars breathe without the group losing its
    // identity as one category.
    const barsWidth = groupWidth * 0.8;
    const barWidth = barsWidth / series.length;

    return {
      viewBox: `0 0 ${geometry.width} ${geometry.height}`,
      content: (
        <>
          {/*
            Gridlines behind everything, drawn from the ink at low alpha rather
            than a fixed grey, so they stay correctly weighted on a dark school
            palette as well as a light one.
          */}
          <g aria-hidden="true">
            {scale.ticks.map((tick) => {
              const y = baseline - scale.ratio(tick) * plotHeight;
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
                        // still visible. A bar that rounds to nothing reads as
                        // "no data", which is a different and much worse
                        // statement than "very little".
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

  const draw = (geometry: Geometry, horizontal: boolean) =>
    horizontal ? drawHorizontal(geometry) : drawVertical(geometry);

  // A chart horizontal on the desktop is horizontal on a phone: the phone's
  // label budget is only ever smaller.
  const desktopHorizontal = orientation === 'horizontal' || labelsOverlap(DESKTOP);
  const phoneHorizontal = desktopHorizontal || labelsOverlap(PHONE);

  const desktop = draw(DESKTOP, desktopHorizontal);
  const phone = draw(PHONE, phoneHorizontal);

  return (
    <ChartFrame
      title={title}
      summary={summary}
      viewBox={desktop.viewBox}
      phone={phone}
      className={className}
      legend={legend}
      dataTable={dataTable}
    >
      {desktop.content}
    </ChartFrame>
  );
}
