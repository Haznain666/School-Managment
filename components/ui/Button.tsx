import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Icon, type LucideIcon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // `text-brand-onPrimary`, not `text-white`: the fill is the school's colour,
  // so the lettering on it has to be chosen from that colour. See
  // `lib/color-contrast.ts`.
  // `hover:opacity-90` until Sprint 10.5, which faded the button *toward the
  // page* — on a dark school palette that made the hover state lighter and
  // weaker, the opposite of the "more" a hover should read as.
  // `--brand-primary-hover` is derived per palette and always moves away from
  // the background.
  primary:
    'bg-brand-primary text-brand-onPrimary hover:bg-brand-primaryHover focus-visible:outline-brand-primary',
  secondary:
    'bg-surface-raised text-ink border border-line-strong hover:bg-surface-hover focus-visible:outline-line-strong',
  // Same reasoning as `primary`, one step further: the fill is the school's
  // *derived* danger colour, so the lettering has to be chosen from that fill
  // rather than assumed to be white. A school whose palette pushes danger light
  // would get invisible text on its delete button otherwise.
  danger:
    'bg-status-danger text-status-danger-on hover:brightness-95 focus-visible:outline-status-danger',
  ghost:
    'bg-transparent text-ink hover:bg-surface-hover focus-visible:outline-line-strong',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction. Implies `disabled`. */
  isLoading?: boolean;
  fullWidth?: boolean;
  /**
   * Leading glyph. Takes the place of the spinner while loading, so the button
   * neither grows nor shifts its label when it starts working.
   */
  icon?: LucideIcon;
  /**
   * Trailing glyph — for a chevron on a menu trigger, or an external-link mark.
   * Not for decoration: two icons on one button is a button that has not
   * decided what it does.
   */
  iconRight?: LucideIcon;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  fullWidth = false,
  icon,
  iconRight,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      // Disabled while loading so a double submit cannot fire twice.
      disabled={disabled === true || isLoading}
      aria-busy={isLoading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {isLoading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : icon !== undefined ? (
        <Icon as={icon} size="sm" />
      ) : null}

      {children}

      {iconRight !== undefined && !isLoading ? <Icon as={iconRight} size="sm" /> : null}
    </button>
  );
}
