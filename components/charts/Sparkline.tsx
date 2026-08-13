import { linePath, type Point } from '@/lib/chart-scale';
import { cn } from '@/lib/utils';

/**
 * A trend small enough to sit inside a KPI tile or a table row.
 *
 * ── No axes, and that is the point ───────────────────────────────────────
 * A sparkline answers one question — which way is this going — and answers it
 * in the space of a word. Adding axes or labels does not make it a better
 * sparkline, it makes it a bad chart. When the reader needs the numbers, the
 * tile beside it carries the current value and the full `LineChart` is a click
 * away.
 *
 * ── Scaled to its own range, not to zero ─────────────────────────────────
 * The opposite rule from `BarChart`. A sparkline is read for *shape*, and an
 * attendance series between 91% and 96% anchored at zero is a flat line that
 * says nothing. Because it carries no axis, there is no scale for the reader to
 * misread — which is exactly what makes the truncation safe here and unsafe
 * there.
 */

export interface SparklineProps {
  values: readonly number[];
  /** Tailwind stroke class. */
  strokeClass?: string;
  /** Fills beneath the line at low opacity. */
  area?: boolean;
  /** Marks the final point, which is the one the reader is standing on. */
  markLast?: boolean;
  /**
   * What the shape means, for screen readers — "rising from 88% to 94% over six
   * months". Required: a decorative-only sparkline should not be rendered at
   * all, and an unlabelled one is invisible to anyone not looking at it.
   */
  label: string;
  className?: string;
}

const WIDTH = 120;
const HEIGHT = 32;
const PADDING = 3;

export function Sparkline({
  values,
  strokeClass = 'stroke-chart-1',
  area = true,
  markLast = true,
  label,
  className,
}: SparklineProps) {
  const present = values.filter((value) => Number.isFinite(value));
  if (present.length < 2) return null;

  const min = Math.min(...present);
  const max = Math.max(...present);
  // A flat series has no range to divide by. Draw it down the middle rather
  // than at the top, which is where a zero span would otherwise put it.
  const span = max - min || 1;

  const stepX = (WIDTH - PADDING * 2) / (present.length - 1);

  const points: Point[] = present.map((value, index) => ({
    x: PADDING + index * stepX,
    y:
      max === min
        ? HEIGHT / 2
        : PADDING + (1 - (value - min) / span) * (HEIGHT - PADDING * 2),
  }));

  const last = points[points.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
      className={cn('block h-8 w-full overflow-visible', className)}
    >
      {area ? (
        <path
          d={`${linePath(points)} L${last.x},${HEIGHT} L${points[0]!.x},${HEIGHT} Z`}
          // `currentColor` at low alpha rather than a paired fill class, so a
          // caller changing `strokeClass` cannot end up with a fill from a
          // different series.
          className={cn(strokeClass, 'fill-current opacity-[0.12] stroke-none')}
        />
      ) : null}

      <path
        d={linePath(points)}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        // `vector-effect` keeps the stroke 1.5px however far the sparkline is
        // stretched by `preserveAspectRatio="none"`, which would otherwise
        // squash it to a hairline in a wide tile.
        vectorEffect="non-scaling-stroke"
        className={strokeClass}
      />

      {markLast ? (
        <circle
          cx={last.x}
          cy={last.y}
          r={2}
          className={cn(strokeClass, 'fill-current stroke-none')}
        />
      ) : null}
    </svg>
  );
}
