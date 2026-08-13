import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The shared shell every chart in this product renders inside.
 *
 * ── Why every chart carries a table ──────────────────────────────────────
 * The `<svg>` is `role="img"` with a title and description, which tells a
 * screen-reader user *what* the chart is but not what it says. So each chart
 * also emits its own data as a real table, visually hidden. That is the only
 * honest way to make a chart accessible: alt text can summarise a trend, but a
 * parent checking their child's term results needs the marks, not a
 * characterisation of them.
 *
 * It costs nothing visually and a few hundred bytes of HTML, and it means the
 * figures survive being read aloud, copied, or found by the browser's own
 * in-page search — which is worth having sighted too.
 *
 * ── Print ────────────────────────────────────────────────────────────────
 * These render on the server as static SVG with no hydration, which is the
 * whole reason a charting library was rejected: a report card goes through
 * `PrintSheet`, and a canvas or a client-hydrating chart is unreliable there.
 * `globals.css` already forces `print-color-adjust: exact` inside a print root,
 * so the fills survive the browser's default of dropping background graphics.
 */

export interface ChartFrameProps {
  /** What the chart is. Becomes the SVG's accessible name. */
  title: string;
  /**
   * What it shows, in one sentence — the trend, the range, the headline. This
   * is the summary a screen reader hears before the table.
   */
  summary: string;
  /** The chart's own coordinate space. */
  viewBox: string;
  /**
   * The accessible table of the same data. Rendered visually hidden.
   * Charts build this themselves because only they know their own shape.
   */
  dataTable: ReactNode;
  /** A visible key, when the chart has more than one series. */
  legend?: ReactNode;
  /**
   * Caps the drawn height so a chart in a narrow column does not become a
   * letterbox. Defaults to the viewBox's own aspect ratio.
   */
  className?: string;
  children: ReactNode;
}

export function ChartFrame({
  title,
  summary,
  viewBox,
  dataTable,
  legend,
  className,
  children,
}: ChartFrameProps) {
  return (
    <figure className={cn('w-full', className)}>
      <svg
        viewBox={viewBox}
        role="img"
        aria-label={`${title}. ${summary}`}
        // `h-auto` with `w-full`: the viewBox governs the aspect ratio, so the
        // chart scales with its container rather than needing a measured width.
        // This is what lets it render identically on the server and on paper.
        className="block h-auto w-full overflow-visible"
      >
        <title>{title}</title>
        <desc>{summary}</desc>
        {children}
      </svg>

      {legend !== undefined ? <div className="mt-3">{legend}</div> : null}

      <figcaption className="sr-only">
        {title}. {summary}
        {dataTable}
      </figcaption>
    </figure>
  );
}

export interface ChartLegendProps {
  items: ReadonlyArray<{
    label: string;
    /** A Tailwind background class, e.g. `bg-chart-1` or `bg-status-danger`. */
    swatchClass: string;
    /** Optional figure shown beside the label. */
    value?: string;
  }>;
  className?: string;
}

/** A key for a multi-series chart. */
export function ChartLegend({ items, className }: ChartLegendProps) {
  return (
    // `aria-hidden`: the legend restates the series names, which the hidden
    // data table already carries as column headers. Announcing both makes a
    // screen reader read every series name twice.
    <ul
      aria-hidden="true"
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', item.swatchClass)} />
          {item.label}
          {item.value !== undefined ? (
            <span className="font-mono font-medium tabular-nums text-ink">{item.value}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export interface ChartEmptyProps {
  /** Why there is nothing to draw. */
  message: string;
  className?: string;
}

/**
 * What a chart renders when it has no data.
 *
 * Kept the same height as a drawn chart would be, so a dashboard whose first
 * term has not started does not collapse into a stack of headings.
 */
export function ChartEmpty({ message, className }: ChartEmptyProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex min-h-[9rem] items-center justify-center rounded-control border border-dashed border-line px-4 py-6 text-center',
        className,
      )}
    >
      <p className="text-pretty text-xs text-ink-muted">{message}</p>
    </div>
  );
}
