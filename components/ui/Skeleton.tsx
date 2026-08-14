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
