import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  danger: 'bg-red-50 text-red-700 ring-red-600/20',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/20',
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
