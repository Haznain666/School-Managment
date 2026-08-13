import type { ReactNode } from 'react';

import { Icon, type LucideIcon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

/**
 * What a screen shows when it has nothing to show.
 *
 * `SPRINTS.md` calls empty states "the single largest cause of a product
 * feeling unfinished, and the cheapest to fix", and the reason is that a screen
 * with no rows is the *first* thing every new school sees. Every list in this
 * product is empty on day one: no students, no challans, no exams, no staff.
 * The interface a school forms its opinion from is this one.
 *
 * ── Three empties, not one ───────────────────────────────────────────────
 * The distinction matters more than the styling, and collapsing it is the
 * common mistake:
 *
 *   `empty`     — nothing exists yet. The reader's next step is to create
 *                 something, so this state carries the action that creates it.
 *   `no-result` — things exist, but this filter or search matched none. The
 *                 reader's next step is to widen the filter, never to create a
 *                 record, and offering "Add student" here is actively wrong.
 *   `error`     — we do not know whether anything exists. The next step is to
 *                 retry, and the copy must not imply the list is empty.
 *
 * A single empty state used for all three tells a school with 400 students that
 * it has none, which is how a search box becomes frightening.
 */

export type EmptyStateTone = 'empty' | 'no-result' | 'error';

export interface EmptyStateProps {
  tone?: EmptyStateTone;
  /** A lucide glyph. Chosen to depict the *content*, not a generic box. */
  icon?: LucideIcon;
  title: string;
  /** One or two sentences. Say what to do next, not that there is nothing. */
  description?: string;
  /** The primary action — typically a Button or a Link styled as one. */
  action?: ReactNode;
  /** A quieter secondary action, e.g. "Clear filters". */
  secondaryAction?: ReactNode;
  /** Renders without the surrounding card, for use inside one. */
  bare?: boolean;
  className?: string;
}

const TONE_GLYPH_CLASSES: Record<EmptyStateTone, string> = {
  empty: 'bg-brand-primarySubtle text-brand-onPrimarySubtle',
  'no-result': 'bg-surface-sunken text-ink-muted',
  error: 'bg-status-danger-subtle text-status-danger-onSubtle',
};

export function EmptyState({
  tone = 'empty',
  icon,
  title,
  description,
  action,
  secondaryAction,
  bare = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      // `status` rather than `alert`: an empty list is information, and an alert
      // interrupts a screen reader mid-sentence to announce that nothing
      // happened.
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        !bare && 'rounded-card border border-line bg-surface-raised',
        className,
      )}
    >
      {icon !== undefined ? (
        <span
          className={cn(
            'mb-4 flex h-12 w-12 items-center justify-center rounded-full',
            TONE_GLYPH_CLASSES[tone],
          )}
        >
          <Icon as={icon} size="lg" />
        </span>
      ) : null}

      <h3 className="text-base font-semibold text-ink">{title}</h3>

      {description !== undefined ? (
        // Capped rather than full-width: an explanation running the width of a
        // desktop table is one 160-character line nobody finishes reading.
        <p className="mt-1.5 max-w-sm text-pretty text-sm text-ink-muted">{description}</p>
      ) : null}

      {action !== undefined || secondaryAction !== undefined ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
