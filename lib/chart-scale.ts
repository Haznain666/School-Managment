/**
 * Scale and geometry helpers for the SVG chart components.
 *
 * Dependency-free and pure, for the same reason `lib/color-contrast.ts` is: the
 * charts render on the server inside `PrintSheet`, and anything they import has
 * to be safe there. There is no charting library in this project and
 * deliberately so — see `SPRINTS.md` Sprint 10.5 deliverable D.
 */

/* -----------------------------------------------------------------------------
 * Axis ticks.
 * -------------------------------------------------------------------------- */

/**
 * A "nice" number near `value` — 1, 2, 2.5, 5 or 10 times a power of ten.
 *
 * Axis ticks have to land on numbers a person would choose. An axis running to
 * 4,317 in steps of 863 is arithmetically correct and unreadable; the same axis
 * running to 5,000 in steps of 1,000 is neither, and is what every chart in
 * every finance report uses.
 */
function niceNumber(value: number, round: boolean): number {
  if (value === 0) return 0;

  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const fraction = Math.abs(value) / 10 ** exponent;

  const niceFraction = round
    ? fraction < 1.5
      ? 1
      : fraction < 3
        ? 2
        : fraction < 7
          ? 5
          : 10
    : fraction <= 1
      ? 1
      : fraction <= 2
        ? 2
        : fraction <= 5
          ? 5
          : 10;

  return niceFraction * 10 ** exponent * Math.sign(value);
}

export interface Scale {
  min: number;
  max: number;
  ticks: readonly number[];
  /** Maps a value onto 0–1 across the scale. */
  ratio: (value: number) => number;
}

/**
 * A linear scale from 0 (or below, if the data goes negative) to a rounded
 * maximum, with ticks a reader would recognise.
 *
 * Anchored at zero for the bar and area charts this product draws. Truncating a
 * bar axis exaggerates differences — a 2% change in collections looking like a
 * collapse — and in a document a school shows to parents that is not a
 * stylistic choice.
 */
export function linearScale(values: readonly number[], tickCount = 4): Scale {
  const present = values.filter((value) => Number.isFinite(value));

  const rawMax = present.length === 0 ? 0 : Math.max(...present, 0);
  const rawMin = present.length === 0 ? 0 : Math.min(...present, 0);

  // An all-zero series still needs an axis, or the chart divides by zero and
  // every bar renders at full height.
  if (rawMax === 0 && rawMin === 0) {
    return { min: 0, max: 1, ticks: [0, 1], ratio: () => 0 };
  }

  const range = niceNumber(rawMax - rawMin, false);
  const step = niceNumber(range / Math.max(1, tickCount), true);

  const min = Math.floor(rawMin / step) * step;
  const max = Math.ceil(rawMax / step) * step;

  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) {
    // Snap to the step to shake off floating-point drift, which otherwise
    // prints an axis label of `0.30000000000000004`.
    ticks.push(Math.round(tick / step) * step);
  }

  const span = max - min || 1;

  return {
    min,
    max,
    ticks,
    ratio: (value: number) => (value - min) / span,
  };
}

/* -----------------------------------------------------------------------------
 * Paths.
 * -------------------------------------------------------------------------- */

export interface Point {
  x: number;
  y: number;
}

/** A straight polyline through the points, as an SVG path `d`. */
export function linePath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)},${round(point.y)}`)
    .join(' ');
}

/**
 * A gently smoothed path through the points.
 *
 * Cardinal-style tangents at a low tension, and — importantly — the control
 * points are only ever horizontal offsets. A general-purpose spline overshoots
 * vertically between two close values, which on an attendance chart draws a dip
 * below zero that never happened. Constraining the curve to horizontal control
 * points makes overshoot impossible while still removing the hard corners.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length < 2) return linePath(points);

  const segments: string[] = [`M${round(points[0]!.x)},${round(points[0]!.y)}`];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const midpoint = (previous.x + current.x) / 2;

    segments.push(
      `C${round(midpoint)},${round(previous.y)} ${round(midpoint)},${round(current.y)} ${round(current.x)},${round(current.y)}`,
    );
  }

  return segments.join(' ');
}

/** Closes a line path down to a baseline, for an area fill. */
export function areaPath(points: readonly Point[], baseline: number, smooth = true): string {
  if (points.length === 0) return '';

  const top = smooth ? smoothPath(points) : linePath(points);
  const first = points[0]!;
  const last = points[points.length - 1]!;

  return `${top} L${round(last.x)},${round(baseline)} L${round(first.x)},${round(baseline)} Z`;
}

/**
 * An SVG arc for one segment of a donut.
 *
 * Angles are clockwise from twelve o'clock, which is where a reader expects a
 * proportion chart to start.
 */
export function donutSegment(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startFraction: number,
  endFraction: number,
): string {
  // A segment covering the whole circle cannot be drawn as one arc — start and
  // end coincide and the browser renders nothing at all. Two half-arcs do it.
  const sweep = endFraction - startFraction;
  if (sweep >= 0.9999) {
    return [
      donutSegment(cx, cy, outerRadius, innerRadius, 0, 0.5),
      donutSegment(cx, cy, outerRadius, innerRadius, 0.5, 1),
    ].join(' ');
  }

  const startAngle = startFraction * 2 * Math.PI - Math.PI / 2;
  const endAngle = endFraction * 2 * Math.PI - Math.PI / 2;
  const largeArc = sweep > 0.5 ? 1 : 0;

  const outerStart = polar(cx, cy, outerRadius, startAngle);
  const outerEnd = polar(cx, cy, outerRadius, endAngle);
  const innerEnd = polar(cx, cy, innerRadius, endAngle);
  const innerStart = polar(cx, cy, innerRadius, startAngle);

  return [
    `M${round(outerStart.x)},${round(outerStart.y)}`,
    `A${outerRadius},${outerRadius} 0 ${largeArc} 1 ${round(outerEnd.x)},${round(outerEnd.y)}`,
    `L${round(innerEnd.x)},${round(innerEnd.y)}`,
    `A${innerRadius},${innerRadius} 0 ${largeArc} 0 ${round(innerStart.x)},${round(innerStart.y)}`,
    'Z',
  ].join(' ');
}

function polar(cx: number, cy: number, radius: number, angle: number): Point {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

/** Two decimal places is well below a printer's resolution, and halves path length. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/* -----------------------------------------------------------------------------
 * Formatting.
 * -------------------------------------------------------------------------- */

/**
 * The left gutter a vertical chart's y-axis needs for its widest tick.
 *
 * ── The defect this exists for ───────────────────────────────────────────
 * `PADDING.left` was the constant `46` in both `BarChart` and `LineChart`, and
 * 46 is the right number for `compactNumber` — `"20k"` is three glyphs. It is
 * the wrong number for any chart that passes a money formatter: `"PKR 20,000"`
 * measures ~56 units, is drawn at `x = left - 8` anchored `end`, and therefore
 * starts at **-16** — sixteen units outside the viewBox, printed over whatever
 * sits to the left of the card.
 *
 * Two charts shipped that way: *Ageing of receivables*, which has been drawing
 * outside itself since Sprint 15, and *Collections by campus*, added in Sprint
 * 19a. Sprint 19a item 5 fixed the **horizontal** category labels and did not
 * look at the vertical axis, which is the same bug one axis over.
 *
 * So the gutter is measured rather than assumed. Callers keep passing whatever
 * formatter suits their data, and a chart that needs more room takes it —
 * which is the only version of this that a future money chart cannot regress.
 *
 * 5.6 units per glyph is the observed average for the 11px face at this
 * viewBox, and the floor of 46 keeps every existing compact-formatted chart
 * pixel-identical to what it drew before.
 */
export function axisGutter(
  ticks: readonly number[],
  format: (value: number) => string,
): number {
  const widest = ticks.reduce((max, tick) => Math.max(max, format(tick).length), 0);
  return Math.max(46, Math.ceil(widest * 5.6) + 10);
}

/**
 * The right gutter a horizontal bar chart needs for the figure printed past the
 * end of its longest bar.
 *
 * ── The defect this exists for (Sprint 20, item 2b) ──────────────────────
 * `H_PADDING.right` was the constant `40`, which is the right number for
 * `compactNumber` — `"20k"` is three glyphs. It is the wrong number for a money
 * formatter: `PKR 20,000` measures ~52 units at 10px and is drawn six units
 * past the bar's end, so on *Collection by campus* the label started at the
 * viewBox's right edge and ran off it. The screenshot from the live tenant
 * reads `PKR 20,00`, with the final glyph outside the SVG and clipped away.
 *
 * This is `axisGutter` one axis over, and it makes the same argument: the
 * gutter is **measured**, not assumed, so a chart topping out at `PKR 1,250,000`
 * takes the room it needs and one topping out at `PKR 900` does not waste it.
 *
 * ── Measured against the values, not against the ticks ───────────────────
 * The ticks are the *axis*, and the axis is a rounded scale that stops at or
 * above the data. What is drawn at the end of a bar is the value itself, and
 * `PKR 1,247,318` is four glyphs wider than the `PKR 1,250,000` tick it sits
 * under. Passing the ticks here would under-reserve on exactly the charts that
 * need it most.
 *
 * 5.2 units per glyph is the observed average for the 10px face at this
 * viewBox — a shade under `axisGutter`'s 5.6, which measures an 11px one — plus
 * the 6-unit offset the label is drawn at and 4 units of breathing room.
 *
 * `floor` is the caller's existing constant, so a chart whose labels are short
 * draws exactly what it drew before this function existed. Passed in rather
 * than hard-coded here because the geometry belongs to the chart.
 */
export function valueGutter(
  values: readonly number[],
  format: (value: number) => string,
  floor: number,
): number {
  const widest = values.reduce(
    (max, value) => (Number.isFinite(value) ? Math.max(max, format(value).length) : max),
    0,
  );
  return Math.max(floor, Math.ceil(widest * 5.2) + 10);
}

/**
 * Compact axis labels in the units this market uses.
 *
 * Lakh and crore rather than K and M: a Pakistani school's accountant reads
 * "1.2 crore", and "12M" is a translation they should not have to perform on a
 * screen about their own money. Below a lakh the plain number is clearer than
 * any abbreviation.
 */
export function compactNumber(value: number): string {
  const magnitude = Math.abs(value);

  if (magnitude >= 10_000_000) return `${trim(value / 10_000_000)}cr`;
  if (magnitude >= 100_000) return `${trim(value / 100_000)}L`;
  if (magnitude >= 1_000) return `${trim(value / 1_000)}k`;

  return String(Math.round(value));
}

function trim(value: number): string {
  // One decimal, but only when it says something: "1.2cr" is useful, "1.0cr"
  // is noise.
  const fixed = value.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}
