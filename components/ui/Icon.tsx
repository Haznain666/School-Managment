import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The one way an icon is drawn in this application.
 *
 * ── Why a wrapper rather than using lucide directly ──────────────────────
 * Before Sprint 10.5 exactly one of 105 component files contained an `<svg>`,
 * so there was no icon style to be inconsistent with. There is now, and the
 * thing that makes a set of icons read as a set is not which library they came
 * from — it is that they share a size, a stroke weight and an optical
 * relationship to the text beside them. Left to per-call-site `className`
 * strings, those drift within a fortnight: one screen at `h-4 w-4`, the next at
 * `h-5 w-5`, a third at lucide's default 24px, and the product looks assembled
 * rather than designed.
 *
 * So: sizes come from a named scale, stroke weight is set once here, and
 * `currentColor` is inherited rather than passed. That last point is what makes
 * icons free under per-tenant theming — an icon inside `text-ink-muted` is
 * muted, an icon inside a `bg-brand-primary` button is `brand-onPrimary`, and
 * neither needed to know the school's palette.
 *
 * ── Decision recorded (Sprint 10.5, deliverable A) ───────────────────────
 * `lucide-react`, chosen over Heroicons and over hand-drawing a set. It is
 * tree-shakeable, so only the icons actually imported reach the bundle — which
 * matters against the <200 kB first-load budget that also decided against a
 * charting library. Its ~500-icon set covers the domain vocabulary this product
 * needs (attendance, payroll, certificates, receipts) where Heroicons' ~300
 * does not, and a hand-drawn set of eighty icons would drift in weight and
 * style precisely as described above.
 */

/**
 * Icon sizes, named for the thing they sit beside rather than for a number.
 *
 * `sm` is the workhorse: it is optically matched to `text-sm`, which is what
 * table cells, buttons, menu items and nav links are set in.
 */
export const ICON_SIZES = {
  /** Inline with `text-xs` — badges, dense metadata. */
  xs: 'h-3.5 w-3.5',
  /** Inline with `text-sm` — buttons, nav, table cells. The default. */
  sm: 'h-4 w-4',
  /** Section headers, page-header actions. */
  md: 'h-5 w-5',
  /** Empty-state and stat-tile glyphs. */
  lg: 'h-6 w-6',
  /** The single illustrative glyph in an empty state. */
  xl: 'h-8 w-8',
} as const;

export type IconSize = keyof typeof ICON_SIZES;

export interface IconProps {
  /** The lucide icon component itself, e.g. `as={GraduationCap}`. */
  as: LucideIcon;
  size?: IconSize;
  /**
   * What the icon means, for a screen reader.
   *
   * Omit it — the default — when the icon repeats adjacent text or is purely
   * decorative, and it is hidden from assistive technology. Supply it only when
   * the icon is the *sole* carrier of meaning, such as an icon-only button.
   */
  label?: string;
  className?: string;
}

export function Icon({ as: Glyph, size = 'sm', label, className }: IconProps) {
  return (
    <Glyph
      // 1.75 rather than lucide's 2: at 16px a 2px stroke reads heavier than
      // the 500-weight text it sits next to, and the pair looks mismatched.
      strokeWidth={1.75}
      aria-hidden={label === undefined ? true : undefined}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      // `shrink-0` because an icon in a flex row next to a long label is
      // otherwise squashed into an ellipse by the text.
      className={cn('shrink-0', ICON_SIZES[size], className)}
    />
  );
}

export type { LucideIcon };
