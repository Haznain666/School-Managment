import type { ReactNode } from 'react';

import { Breadcrumb, type Crumb } from '@/components/ui/Breadcrumb';
import { cn } from '@/lib/utils';

/**
 * The top of a page: where you are, what this is, and the one thing to do here.
 *
 * ── Why this is a component and not a convention ─────────────────────────
 * Before Sprint 10.5 every screen wrote its own heading, and they disagreed —
 * different sizes, different spacing, some with a description and some without,
 * action buttons variously left, right and wrapped. A reader moving between
 * Challans and Staff had to re-find the page title each time. Standardising the
 * top 80 pixels does more for coherence than any amount of polish further down.
 *
 * ── The action slot holds one primary action ─────────────────────────────
 * `actions` is deliberately a slot rather than a list. A page with four
 * equally-weighted buttons in its header has not decided what it is for, and
 * the fix is a menu or a move into the content — not a wider header. Where a
 * second action is genuinely warranted it goes in as a `secondary` Button, and
 * the primary one goes last so it sits closest to the page's own content.
 */

export interface PageHeaderProps {
  title: string;
  /** One sentence. What this screen is for, or the scope it is showing. */
  description?: string;
  /** The trail above the title. Omit on a portal's own landing page. */
  breadcrumbs?: readonly Crumb[];
  /** Primary action, and at most one secondary beside it. */
  actions?: ReactNode;
  /**
   * Tabs or filters belonging to this page, rendered below the title and
   * flush with the header's bottom edge so the two read as one unit.
   */
  below?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  below,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('mb-6', className)}>
      {breadcrumbs !== undefined && breadcrumbs.length > 0 ? (
        <Breadcrumb items={breadcrumbs} className="mb-2" />
      ) : null}

      {/*
        Column on a phone, row from `sm`. A header that stays a row on a narrow
        screen either squeezes the title to two characters or pushes the button
        off the edge; stacking is the honest answer, and the action keeps its
        full width where it is easiest to hit.
      */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-balance text-2xl font-semibold text-ink">{title}</h1>
          {description !== undefined ? (
            // Capped at a readable measure rather than the full page width,
            // which on a desktop table screen is a 160-character line.
            <p className="mt-1 max-w-2xl text-pretty text-sm text-ink-muted">{description}</p>
          ) : null}
        </div>

        {actions !== undefined ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {below !== undefined ? <div className="mt-4">{below}</div> : null}
    </header>
  );
}
