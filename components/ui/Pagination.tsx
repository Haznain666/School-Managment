'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

/**
 * Paging for the long lists — students, challans, applications, staff.
 *
 * ── It reports a range, not just a page number ───────────────────────────
 * "Showing 21–40 of 409" answers the question people actually have, which is
 * how much is left, and it is the sentence that makes a 409-student roll feel
 * navigable rather than endless. "Page 2 of 21" makes the reader do the
 * arithmetic. Both are cheap; only one is useful.
 *
 * ── The window ───────────────────────────────────────────────────────────
 * Page numbers are windowed around the current page with the first and last
 * always present, because "jump to the end" is a real intent — the newest
 * applications, the last challan issued. The window keeps a constant width so
 * the control does not resize as it is used, which is what makes a Next button
 * move out from under the cursor mid-click.
 *
 * ── Rendering ────────────────────────────────────────────────────────────
 * Deliberately renders `<button>` and takes an `onPageChange`, rather than
 * emitting links. The lists in this product carry filter state that lives in
 * the URL alongside the page, and a component that built its own hrefs would
 * have to know about every screen's filters. The caller owns the URL; this owns
 * the control.
 */

export interface PaginationProps {
  /** 1-based. */
  page: number;
  pageSize: number;
  /** Total rows across all pages, not the length of the current page. */
  totalItems: number;
  onPageChange: (page: number) => void;
  /** What is being counted, for the range sentence. */
  itemNoun?: { singular: string; plural: string };
  /** Disables every control, e.g. while the next page is loading. */
  disabled?: boolean;
  className?: string;
}

/** How many numbered pages sit either side of the current one. */
const WINDOW = 1;

function pagesToShow(page: number, totalPages: number): Array<number | 'gap'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages, page]);
  for (let offset = 1; offset <= WINDOW; offset += 1) {
    if (page - offset > 1) pages.add(page - offset);
    if (page + offset < totalPages) pages.add(page + offset);
  }

  // Pad the window when the current page is near an end, so the control keeps a
  // constant width instead of shrinking at the extremes.
  if (page <= 3) {
    for (let candidate = 2; candidate <= 4 && candidate < totalPages; candidate += 1) {
      pages.add(candidate);
    }
  }
  if (page >= totalPages - 2) {
    for (let candidate = totalPages - 3; candidate < totalPages; candidate += 1) {
      if (candidate > 1) pages.add(candidate);
    }
  }

  const ordered = [...pages].sort((a, b) => a - b);
  const withGaps: Array<number | 'gap'> = [];

  for (const [index, value] of ordered.entries()) {
    const previous = ordered[index - 1];
    if (previous !== undefined && value - previous > 1) withGaps.push('gap');
    withGaps.push(value);
  }

  return withGaps;
}

export function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  itemNoun = { singular: 'result', plural: 'results' },
  disabled = false,
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);

  const firstShown = totalItems === 0 ? 0 : (current - 1) * pageSize + 1;
  const lastShown = Math.min(current * pageSize, totalItems);

  const noun = totalItems === 1 ? itemNoun.singular : itemNoun.plural;

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'flex flex-col-reverse items-center justify-between gap-3 sm:flex-row',
        className,
      )}
    >
      {/*
        `aria-live` so that changing page announces the new range. Without it a
        screen-reader user presses Next and hears nothing.
      */}
      <p aria-live="polite" className="text-xs text-ink-muted">
        {totalItems === 0 ? (
          <>No {itemNoun.plural}</>
        ) : (
          <>
            Showing{' '}
            <span className="font-mono font-medium tabular-nums text-ink">
              {firstShown.toLocaleString()}–{lastShown.toLocaleString()}
            </span>{' '}
            of{' '}
            <span className="font-mono font-medium tabular-nums text-ink">
              {totalItems.toLocaleString()}
            </span>{' '}
            {noun}
          </>
        )}
      </p>

      {totalPages > 1 ? (
        <div className="flex items-center gap-1">
          <PageButton
            onClick={() => onPageChange(current - 1)}
            disabled={disabled || current === 1}
            label="Previous page"
          >
            <Icon as={ChevronLeft} size="sm" />
          </PageButton>

          {pagesToShow(current, totalPages).map((entry, index) =>
            entry === 'gap' ? (
              <span
                key={`gap-${index}`}
                aria-hidden="true"
                className="px-1 text-xs text-ink-faint"
              >
                …
              </span>
            ) : (
              <PageButton
                key={entry}
                onClick={() => onPageChange(entry)}
                disabled={disabled}
                active={entry === current}
                label={`Page ${entry}`}
                current={entry === current}
              >
                <span className="font-mono tabular-nums">{entry}</span>
              </PageButton>
            ),
          )}

          <PageButton
            onClick={() => onPageChange(current + 1)}
            disabled={disabled || current === totalPages}
            label="Next page"
          >
            <Icon as={ChevronRight} size="sm" />
          </PageButton>
        </div>
      ) : null}
    </nav>
  );
}

interface PageButtonProps {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  current?: boolean;
  label: string;
  children: ReactNode;
}

function PageButton({
  onClick,
  disabled = false,
  active = false,
  current = false,
  label,
  children,
}: PageButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      className={cn(
        // A square minimum so single- and double-digit pages are the same size
        // and the row does not jitter as the number grows.
        'inline-flex h-8 min-w-8 items-center justify-center rounded-control px-2 text-xs font-medium',
        'transition-colors duration-fast',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'bg-brand-primary text-brand-onPrimary'
          : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
