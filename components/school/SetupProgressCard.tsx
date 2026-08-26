import { Check } from 'lucide-react';
import Link from 'next/link';

import { Card, CardTitle } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import type { SetupProgress } from '@/lib/dashboard-queries';
import { cn } from '@/lib/utils';

/**
 * How far this school is from being usable: a bar and six headcounts.
 *
 * ── It is a headcount panel, not only a checklist ────────────────────────
 * The requirement asked for the entities *and* their counts, and that is the
 * part that keeps it useful after week one. A checklist of six ticks is
 * finished forever and becomes furniture; "Teachers 14 · Classes 22 ·
 * Students 610" is a summary of the school that is worth a glance in March.
 * So a completed row keeps its number and loses only its link.
 *
 * ── Never colour alone ───────────────────────────────────────────────────
 * A done row carries a tick glyph as well as the tint, and an outstanding one
 * carries the words "Not set up yet" as well as its own. The bar states its
 * percentage in text beside it. Somebody who cannot distinguish the two greens
 * loses nothing.
 *
 * ── It disappears when there is nothing to say ───────────────────────────
 * At 100% the card collapses to one line rather than vanishing. Vanishing would
 * be worse: a school that finishes setting up and then deletes its last section
 * would see a panel reappear that it had never consciously seen go, which reads
 * as a fault. One line saying everything is in place, with the numbers on it,
 * is the honest resting state.
 */

export interface SetupProgressCardProps {
  progress: SetupProgress;
  /** True for a scoped principal, so the heading says whose numbers these are. */
  scoped?: boolean;
}

export function SetupProgressCard({ progress, scoped = false }: SetupProgressCardProps) {
  const complete = progress.completed === progress.total;

  return (
    <Card
      header={
        <CardTitle
          title="School setup"
          description={
            complete
              ? scoped
                ? 'Everything your division needs is in place.'
                : 'Everything this school needs is in place.'
              : `${progress.completed} of ${progress.total} in place. The rest is what is holding the product back.`
          }
        />
      }
    >
      <div className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-ink">Progress</p>
            {/* The number in words beside the bar: a bar alone is unreadable
                to a screen reader and imprecise to everybody else. */}
            <p className="text-sm font-semibold tabular-nums text-ink">
              {progress.percent}%
            </p>
          </div>

          <div
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`School setup: ${progress.completed} of ${progress.total} complete`}
            className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-slow ease-out-quart',
                complete ? 'bg-status-success' : 'bg-brand-primary',
              )}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {progress.steps.map((step) => {
            const inner = (
              <>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                      step.done
                        ? 'bg-status-success text-status-success-on'
                        : 'border border-dashed border-line-strong',
                    )}
                  >
                    {step.done ? <Icon as={Check} size="xs" /> : null}
                  </span>

                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {step.label}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">
                      {step.done ? step.hint : `Not set up yet — ${step.hint}`}
                    </span>
                  </span>
                </span>

                <span
                  className={cn(
                    'shrink-0 text-base font-bold tabular-nums',
                    step.done ? 'text-ink' : 'text-ink-faint',
                  )}
                >
                  {step.count}
                </span>
              </>
            );

            const className = cn(
              'flex items-center justify-between gap-3 rounded-control border px-3 py-2',
              step.done
                ? 'border-line bg-surface-sunken'
                : 'border-status-warning/40 bg-status-warning-subtle',
            );

            return (
              <li key={step.key}>
                {step.href === null ? (
                  <div className={className}>{inner}</div>
                ) : (
                  <Link
                    href={step.href}
                    className={cn(className, 'transition hover:border-brand-primary')}
                  >
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
