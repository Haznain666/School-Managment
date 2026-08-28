import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

/**
 * Where the reader is, inside a navigation tree that gets deep.
 *
 * This product nests further than a sidebar can show:
 * Dashboard → Fees → Challans → a student's challan → its print view; Exams →
 * a term → a paper → marks entry. The sidebar highlights "Vouchers" for all
 * five, so without a trail the reader's only way back up is the browser button
 * — and after a form submission that is a resubmission prompt.
 *
 * ── Truncation ───────────────────────────────────────────────────────────
 * Long trails collapse in the middle rather than wrapping onto a second line.
 * The first crumb is the one that gets you out and the last two are where you
 * are; the middle is the part nobody clicks. A wrapped trail pushes the page
 * heading down by a line at exactly the widths where vertical space is
 * scarcest.
 */

export interface Crumb {
  label: string;
  /** Omit on the final crumb — the current page is not a link to itself. */
  href?: string;
}

export interface BreadcrumbProps {
  items: readonly Crumb[];
  /** Collapse the middle once the trail exceeds this many crumbs. */
  maxItems?: number;
  className?: string;
}

export function Breadcrumb({ items, maxItems = 4, className }: BreadcrumbProps) {
  if (items.length === 0) return null;

  const collapsed = items.length > maxItems;

  // Keep the first, an ellipsis, and the last two.
  const shown: Array<Crumb | 'ellipsis'> = collapsed
    ? [items[0]!, 'ellipsis', ...items.slice(-2)]
    : [...items];

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-ink-muted">
        {shown.map((entry, index) => {
          const isLast = index === shown.length - 1;

          return (
            <li key={index} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <Icon as={ChevronRight} size="xs" className="text-ink-faint" />
              ) : null}

              {entry === 'ellipsis' ? (
                <span
                  // Announced so the trail does not read as if steps are
                  // missing without explanation.
                  aria-label={`${items.length - 3} more levels`}
                  className="px-0.5"
                >
                  …
                </span>
              ) : isLast ? (
                <span aria-current="page" className="truncate font-medium text-ink">
                  {entry.label}
                </span>
              ) : entry.href === undefined ? (
                <span className="truncate">{entry.label}</span>
              ) : (
                <Link
                  href={entry.href}
                  className="truncate rounded-sm hover:text-ink hover:underline"
                >
                  {entry.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
