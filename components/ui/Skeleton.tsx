import { cn } from '@/lib/utils';

/**
 * Loading placeholders shaped like the content they stand in for.
 *
 * A skeleton is worth having only when it is the *shape* of what is coming. A
 * generic grey box that becomes a table teaches the reader nothing and makes
 * the arrival feel like a jump; a box already laid out as rows and columns
 * makes it feel like focus. That is why this file ships `SkeletonTable` and
 * `SkeletonStatTiles` rather than only the atom — the atom on its own invites
 * exactly the generic-grey-box use.
 *
 * Preferred over a spinner in the middle of content, which reports that
 * something is happening without saying what or where.
 */

export interface SkeletonProps {
  className?: string;
}

/**
 * One placeholder block.
 *
 * The sweep is a moving highlight rather than a pulse: a dozen rows pulsing in
 * unison at the same rate reads as a fault indicator, where a sweep reads as
 * loading. Under `prefers-reduced-motion` the animation is neutralised globally
 * in `globals.css` and this stays a static tinted block, which still does its
 * job — the shape was always the point, not the movement.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-shimmer rounded-control bg-surface-sunken',
        // The highlight is a tint of the ink rather than white, so the sweep is
        // visible on a dark school palette as well as a light one.
        'bg-[linear-gradient(90deg,rgb(var(--surface-sunken))_0%,rgb(var(--ink)/0.07)_50%,rgb(var(--surface-sunken))_100%)] bg-[length:200%_100%]',
        className,
      )}
    />
  );
}

export interface SkeletonTextProps {
  /** How many lines to draw. */
  lines?: number;
  className?: string;
}

/**
 * A paragraph placeholder. The last line is short, because real paragraphs end
 * mid-line and a block of equal-length bars reads as a barcode.
 */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn('h-3.5', index === lines - 1 ? 'w-2/5' : 'w-full')}
        />
      ))}
    </div>
  );
}

export interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

/**
 * A table placeholder, header included.
 *
 * Column widths alternate rather than being uniform, so the block reads as a
 * table of varied data rather than as a grid of identical cells.
 */
export function SkeletonTable({ rows = 6, columns = 4, className }: SkeletonTableProps) {
  const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-2/5'];

  return (
    <div
      role="status"
      aria-label="Loading results"
      className={cn('overflow-hidden rounded-card border border-line', className)}
    >
      <div
        className="flex gap-4 border-b border-line bg-surface-sunken px-4 py-3"
        aria-hidden="true"
      >
        {Array.from({ length: columns }, (_, column) => (
          <Skeleton key={column} className="h-3 flex-1" />
        ))}
      </div>

      <div className="divide-y divide-line bg-surface-raised">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-4 px-4 py-3.5" aria-hidden="true">
            {Array.from({ length: columns }, (_, column) => (
              <div key={column} className="flex-1">
                <Skeleton className={cn('h-3.5', widths[(row + column) % widths.length])} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface SkeletonStatTilesProps {
  count?: number;
  className?: string;
}

/** Dashboard KPI placeholders, matching `StatTile`'s proportions. */
export function SkeletonStatTiles({ count = 4, className }: SkeletonStatTilesProps) {
  return (
    <div
      role="status"
      aria-label="Loading summary"
      className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', className)}
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="rounded-card border border-line bg-surface-raised p-5"
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-20" />
          <Skeleton className="mt-3 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Page-shaped skeletons
//
// Everything below composes the atoms above into the four shapes this product
// actually has, so a route's `loading.tsx` is a single line that names its
// shape rather than thirty lines of hand-placed boxes. Adding a fifth shape is
// preferable to hand-rolling one in a route file — see `docs` in CLAUDE.md.
// -----------------------------------------------------------------------------

export interface SkeletonPageHeaderProps {
  /** Draw the placeholder for a right-hand action button. */
  action?: boolean;
  /** Draw the placeholder for the breadcrumb line above the title. */
  breadcrumb?: boolean;
  className?: string;
}

/** Matches `PageHeader` — eyebrow, title, optional description and action. */
export function SkeletonPageHeader({
  action = false,
  breadcrumb = true,
  className,
}: SkeletonPageHeaderProps) {
  return (
    <div className={cn('mb-6 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0 flex-1">
        {breadcrumb ? <Skeleton className="h-3 w-40" /> : null}
        <Skeleton className={cn('h-7 w-64', breadcrumb && 'mt-3')} />
        <Skeleton className="mt-3 h-3.5 w-80 max-w-full" />
      </div>
      {action ? <Skeleton className="h-9 w-32 shrink-0" /> : null}
    </div>
  );
}

export interface SkeletonFormProps {
  /** How many input rows to draw. */
  fields?: number;
  /** Lay the fields out in two columns, as the wider forms in this app do. */
  columns?: 1 | 2;
  className?: string;
}

/**
 * A form placeholder — label above control, in a card, with a submit row.
 *
 * The label bar is deliberately much shorter than the control below it; a
 * stack of equal-width bars reads as a list, not as a form.
 */
export function SkeletonForm({ fields = 6, columns = 2, className }: SkeletonFormProps) {
  return (
    <div
      role="status"
      aria-label="Loading form"
      className={cn('rounded-card border border-line bg-surface-raised p-6', className)}
    >
      <div
        className={cn('grid gap-5', columns === 2 && 'sm:grid-cols-2')}
        aria-hidden="true"
      >
        {Array.from({ length: fields }, (_, index) => (
          <div key={index}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-9 w-full" />
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-end gap-3 border-t border-line pt-5" aria-hidden="true">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-32" />
      </div>
    </div>
  );
}

export interface SkeletonDetailProps {
  /** How many label/value pairs to draw. */
  rows?: number;
  className?: string;
}

/** A read-only record: a summary card of label/value pairs, then a panel. */
export function SkeletonDetail({ rows = 8, className }: SkeletonDetailProps) {
  return (
    <div role="status" aria-label="Loading record" className={cn('space-y-6', className)}>
      <div
        className="rounded-card border border-line bg-surface-raised p-6"
        aria-hidden="true"
      >
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        </div>

        <div className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {Array.from({ length: rows }, (_, index) => (
            <div key={index}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-4 w-40 max-w-full" />
            </div>
          ))}
        </div>
      </div>

      <SkeletonText lines={4} />
    </div>
  );
}

export interface SkeletonChartProps {
  /** Height of the plot area, in Tailwind height classes. */
  className?: string;
  /** Draw a legend row under the plot. */
  legend?: boolean;
}

/**
 * A chart placeholder: bars of varying height rather than one grey rectangle,
 * so the space reads as a chart arriving instead of an image failing to load.
 */
export function SkeletonChart({ className, legend = true }: SkeletonChartProps) {
  const heights = [
    'h-1/3', 'h-2/3', 'h-1/2', 'h-5/6', 'h-2/5', 'h-3/4', 'h-1/2', 'h-full',
    'h-3/5', 'h-1/4', 'h-4/5', 'h-1/2',
  ];

  return (
    <div
      role="status"
      aria-label="Loading chart"
      className={cn('rounded-card border border-line bg-surface-raised p-5', className)}
    >
      <Skeleton className="h-3 w-32" />

      <div className="mt-5 flex h-40 items-end gap-2" aria-hidden="true">
        {heights.map((height, index) => (
          <Skeleton key={index} className={cn('flex-1 rounded-t-control', height)} />
        ))}
      </div>

      {legend ? (
        <div className="mt-4 flex gap-4" aria-hidden="true">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * A print/preview document placeholder — a sheet of paper with lines on it.
 *
 * The print routes render an A4-shaped document rather than an app screen, and
 * the table skeleton against a white sheet looked like a broken page.
 */
export function SkeletonDocument({ className }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Preparing document"
      className={cn(
        'mx-auto w-full max-w-3xl rounded-card border border-line bg-surface-raised p-8',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-6" aria-hidden="true">
        <Skeleton className="h-16 w-16" />
        <div className="flex-1">
          <Skeleton className="mx-auto h-5 w-56" />
          <Skeleton className="mx-auto mt-2 h-3 w-40" />
        </div>
        <Skeleton className="h-16 w-16" />
      </div>

      <div className="mt-8 grid gap-x-8 gap-y-3 sm:grid-cols-2" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))}
      </div>

      <SkeletonTable className="mt-8" rows={5} columns={4} />

      <div className="mt-8 flex justify-end" aria-hidden="true">
        <Skeleton className="h-10 w-40" />
      </div>
    </div>
  );
}

/**
 * A chat inbox and thread placeholder — a list beside a run of bubbles.
 *
 * The sixth shape, added by Sprint 24 rather than hand-placing boxes in four
 * route files, which is what `CLAUDE.md` asks for. It exists because none of
 * the five fitted: a chat screen is two columns of different things, and the
 * table skeleton drew six equal rows across both, promising a layout that then
 * jumped.
 *
 * The bubbles alternate sides and vary in width. A run of identical centred
 * bars reads as a loading spinner in disguise; what is arriving is a
 * conversation, and the skeleton is worth having only when it is the shape of
 * what is coming.
 */
export function SkeletonChat({ className }: SkeletonProps) {
  const widths = ['w-3/5', 'w-2/5', 'w-4/5', 'w-1/2', 'w-3/4'];

  return (
    <div
      role="status"
      aria-label="Loading conversations"
      className={cn('grid gap-4 lg:grid-cols-[20rem_1fr]', className)}
    >
      <div
        className="rounded-card border border-line bg-surface-raised p-3"
        aria-hidden="true"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="mt-2 h-3 w-full" />
            </div>
          </div>
        ))}
      </div>

      <div
        className="flex min-h-[24rem] flex-col rounded-card border border-line bg-surface-raised p-4"
        aria-hidden="true"
      >
        <Skeleton className="h-4 w-48" />
        <div className="mt-6 flex-1 space-y-4">
          {widths.map((width, index) => (
            <div
              key={index}
              className={cn('flex', index % 2 === 1 ? 'justify-end' : 'justify-start')}
            >
              <Skeleton className={cn('h-12 rounded-card', width)} />
            </div>
          ))}
        </div>
        <Skeleton className="mt-4 h-11 w-full" />
      </div>
    </div>
  );
}
