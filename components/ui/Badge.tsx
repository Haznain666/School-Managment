import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'neutral';

/**
 * Sprint 10.5: these were fixed Tailwind ramps — `emerald-50`, `amber-50`,
 * `red-50` — which is why a maroon-branded school's status badges came out in
 * a palette it had never chosen. They now come from `lib/brand-derive.ts`,
 * which leans each status toward the school's own colour while holding it
 * inside the hue band where it still means what it means.
 *
 * The `subtle`/`onSubtle` pair is used rather than the solid fill: a table of
 * forty rows each carrying a saturated block of colour is unreadable, and the
 * wash is what lets a status be scannable without shouting. `solid` is
 * available for the rare badge that must be found at a glance across a room —
 * the overdue count on a fee counter screen.
 */
const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: 'bg-status-success-subtle text-status-success-onSubtle ring-[rgb(var(--status-success)/0.25)]',
  warning: 'bg-status-warning-subtle text-status-warning-onSubtle ring-[rgb(var(--status-warning)/0.25)]',
  danger: 'bg-status-danger-subtle text-status-danger-onSubtle ring-[rgb(var(--status-danger)/0.25)]',
  info: 'bg-status-info-subtle text-status-info-onSubtle ring-[rgb(var(--status-info)/0.25)]',
  brand: 'bg-brand-primarySubtle text-brand-onPrimarySubtle ring-[rgb(var(--brand-primary)/0.25)]',
  neutral: 'bg-surface-sunken text-ink-muted ring-[rgb(var(--ink)/0.16)]',
};

export interface BadgeProps {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}

export function Badge({ variant = 'neutral', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Maps the status strings used across the schema onto badge variants. */
export function statusToBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case 'active':
    case 'enrolled':
      return 'success';
    case 'on_leave':
    case 'suspended':
      return 'warning';
    case 'inactive':
    case 'withdrawn':
    case 'resigned':
      return 'danger';
    default:
      return 'neutral';
  }
}
