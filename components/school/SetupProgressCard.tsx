import { Check } from 'lucide-react';
import Link from 'next/link';

import { Card, CardTitle } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import type { SetupProgress, SetupStep } from '@/lib/dashboard-queries';
import { cn } from '@/lib/utils';

/**
 * How far this school is from being usable: a bar, and one bar per KPI.
 *
 * ── It is a headcount panel, not only a checklist ────────────────────────
 * The requirement asked for the entities *and* their counts, and that is the
 * part that keeps it useful after week one. A checklist of ticks is finished
 * forever and becomes furniture; "Teachers 14 · Classes 22 · Students 610" is a
 * summary of the school that is worth a glance in March. So a completed row
 * keeps its numbers and loses only its link.
 *
 * ── Why every row now carries its own bar (Sprint 17) ────────────────────
 * Six ticks answered six yes/no questions, and three of them were not yes/no
 * questions. "Classes ✓" was true of a school with sections on five of its
 * fourteen grades, and a tick against a partly done job is worse than no tick
 * because it stops anybody looking. Each row now shows `done/total` and its own
 * percentage, and the headline is the **mean of those percentages** rather than
 * the count of finished rows — so the bar moves when the work moves.
 *
 * ── The fee heads are grouped, so eleven rows still read as six areas ────
 * One KPI per fee head is what the product owner asked for, and eleven
 * undifferentiated rows would have buried the six that are about the school
 * itself. The fee rows sit under their own subheading with one link between
 * them, which is also the honest layout: they are all fixed on the same screen.
 *
 * ── Never colour alone ───────────────────────────────────────────────────
 * A complete row carries a tick glyph as well as the tint, and every bar states
 * its fraction in text beside it. Somebody who cannot distinguish the two
 * greens loses nothing.
 */

export interface SetupProgressCardProps {
  progress: SetupProgress;
}

export function SetupProgressCard({ progress }: SetupProgressCardProps) {
  const complete = progress.completed === progress.total;

  const schoolSteps = progress.steps.filter((step) => step.group === 'school');
  const feeSteps = progress.steps.filter((step) => step.group === 'fees');

  return (
    <Card
      header={
        <CardTitle
          title="School setup"
          description={
            complete
              ? 'Everything this school needs is in place.'
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
            aria-label={`School setup: ${progress.percent}% complete, ${progress.completed} of ${progress.total} areas finished`}
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
          {schoolSteps.map((step) => (
            <li key={step.key}>
              <StepRow step={step} />
            </li>
          ))}
        </ul>

        {feeSteps.length === 0 ? null : (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Fee structure
            </h3>
            {/*
              One sentence, once, for the whole group. It is the rule that
              decides every one of these bars and it is not guessable: a blank
              cell reads as "not decided yet", which is why a school that
              genuinely charges nothing has to type the zero.
            */}
            <p className="mt-1 text-xs text-ink-muted">
              A grade counts as priced once it has an amount — including a
              deliberate 0. A blank cell means the decision has not been made.
            </p>

            <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {feeSteps.map((step) => (
                <li key={step.key}>
                  <StepRow step={step} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function StepRow({ step }: { step: SetupStep }) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
              step.complete
                ? 'bg-status-success text-status-success-on'
                : 'border border-dashed border-line-strong',
            )}
          >
            {step.complete ? <Icon as={Check} size="xs" /> : null}
          </span>

          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">
              {step.label}
            </span>
            <span className="block truncate text-xs text-ink-muted">
              {step.complete ? step.hint : `Not finished — ${step.hint}`}
            </span>
          </span>
        </span>

        <span
          className={cn(
            'shrink-0 text-right text-base font-bold tabular-nums',
            step.complete ? 'text-ink' : 'text-ink-faint',
          )}
        >
          {step.count}
          {/* `n/m` beside the count, because the count alone is what made the
              old panel say a job was done that was a third done. */}
          <span className="block text-xs font-medium text-ink-muted">
            {step.done}/{step.total}
          </span>
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={step.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${step.label}: ${step.done} of ${step.total}`}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-slow ease-out-quart',
            step.complete ? 'bg-status-success' : 'bg-brand-primary',
          )}
          style={{ width: `${step.percent}%` }}
        />
      </div>
    </>
  );

  const className = cn(
    'block rounded-control border px-3 py-2',
    step.complete
      ? 'border-line bg-surface-sunken'
      : 'border-status-warning/40 bg-status-warning-subtle',
  );

  return step.href === null ? (
    <div className={className}>{inner}</div>
  ) : (
    <Link
      href={step.href}
      className={cn(className, 'transition hover:border-brand-primary')}
    >
      {inner}
    </Link>
  );
}
