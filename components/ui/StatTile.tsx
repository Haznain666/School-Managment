import type { ReactNode } from 'react';

import { Icon, type LucideIcon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

/**
 * A single figure on a dashboard: students enrolled, collected today,
 * outstanding, staff on leave.
 *
 * ── The pending-module case, which is the reason this has three states ───
 * `SPRINTS.md` records a dependency that would otherwise produce a lie: the
 * dashboard's income and expense tiles need the ledger from Sprint 13.5, which
 * does not exist yet. A tile that renders `PKR 0` for a school that collected
 * three lakh rupees this morning is worse than no tile, because it is
 * confidently wrong and the reader has no way to tell.
 *
 * So `unavailable` is a first-class state with its own copy, not a zero. The
 * same state covers a module the school has not enabled.
 *
 * ── Deltas ───────────────────────────────────────────────────────────────
 * A change is drawn as a direction plus a comparison period, and the direction
 * is stated in words for screen readers rather than left to the arrow. Whether
 * up is good is not universal — collections rising is good, outstanding debt
 * rising is not — so `deltaMeaning` decides the colour and defaults to
 * neutral. Guessing from the sign is how a dashboard congratulates a school on
 * its growing arrears.
 */

export type DeltaMeaning = 'good' | 'bad' | 'neutral';

export interface StatTileProps {
  label: string;
  /**
   * The figure. Pre-formatted by the caller — currency, thousands separators
   * and locale are the caller's business, not this component's.
   */
  value?: ReactNode;
  /** A quiet line beneath the figure: "of 412 enrolled", "as at 14:30". */
  detail?: string;
  icon?: LucideIcon;
  /** e.g. `+12.4%` or `+38`. Pre-formatted, including its sign. */
  delta?: string;
  /** What the delta's direction means for this particular figure. */
  deltaMeaning?: DeltaMeaning;
  /** Period the delta is measured against: "vs last month". */
  deltaPeriod?: string;
  /**
   * The figure cannot be shown, and why — "Needs the accounting ledger",
   * "Fee module not enabled". Renders instead of the value. Never render a zero
   * in this situation.
   */
  unavailable?: string;
  /** Optional visual, typically a `Sparkline`. */
  visual?: ReactNode;
  className?: string;
}

const DELTA_CLASSES: Record<DeltaMeaning, string> = {
  good: 'text-status-success-ink',
  bad: 'text-status-danger-ink',
  neutral: 'text-ink-muted',
};

export function StatTile({
  label,
  value,
  detail,
  icon,
  delta,
  deltaMeaning = 'neutral',
  deltaPeriod,
  unavailable,
  visual,
  className,
}: StatTileProps) {
  const isUnavailable = unavailable !== undefined;

  return (
    <div
      className={cn(
        'rounded-card border border-line bg-surface-raised p-5',
        'transition-shadow duration-fast hover:shadow-raised',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
          {label}
        </p>
        {icon !== undefined ? (
          <span
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-control',
              isUnavailable
                ? 'bg-surface-sunken text-ink-faint'
                : 'bg-brand-primarySubtle text-brand-onPrimarySubtle',
            )}
          >
            <Icon as={icon} size="md" />
          </span>
        ) : null}
      </div>

      {isUnavailable ? (
        <>
          {/*
            An em dash rather than a zero, at the same size as a real figure so
            the tile keeps its height and the row of tiles stays aligned.
          */}
          <p className="mt-2 text-stat font-semibold leading-none text-ink-faint" aria-hidden="true">
            —
          </p>
          <p className="mt-2.5 text-xs text-ink-muted">
            <span className="sr-only">{label} is unavailable. </span>
            {unavailable}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 font-mono text-stat font-semibold tabular-nums text-ink">
            {value}
          </p>

          {delta !== undefined || detail !== undefined ? (
            <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
              {delta !== undefined ? (
                <span className={cn('font-mono font-semibold tabular-nums', DELTA_CLASSES[deltaMeaning])}>
                  {delta}
                  {/*
                    The direction said in words. An arrow or a colour alone
                    fails for a screen-reader user and for the ~8% of men with
                    a red-green deficiency.
                  */}
                  <span className="sr-only">
                    {deltaMeaning === 'good'
                      ? ' — an improvement'
                      : deltaMeaning === 'bad'
                        ? ' — a deterioration'
                        : ' — change'}
                  </span>
                </span>
              ) : null}
              {deltaPeriod !== undefined ? (
                <span className="text-ink-muted">{deltaPeriod}</span>
              ) : null}
              {detail !== undefined ? <span className="text-ink-muted">{detail}</span> : null}
            </div>
          ) : null}
        </>
      )}

      {visual !== undefined && !isUnavailable ? <div className="mt-4">{visual}</div> : null}
    </div>
  );
}

export interface StatTileGridProps {
  children: ReactNode;
  className?: string;
}

/**
 * The row of tiles at the top of a dashboard.
 *
 * `auto-fit` with a floor rather than fixed breakpoint columns: the tiles
 * reflow at whatever width they actually run out of room, which is the right
 * answer inside a sidebar layout whose content width is not the viewport width.
 */
export function StatTileGrid({ children, className }: StatTileGridProps) {
  return (
    <div
      className={cn('grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]', className)}
    >
      {children}
    </div>
  );
}
