'use client';

import type { ReactNode } from 'react';
import { useCallback, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * A short label revealed on hover or focus.
 *
 * ── Positioned `fixed`, measured from the trigger ────────────────────────
 * The same clipping hazard as `Modal`: this product nests cards inside
 * scrolling panels, and an absolutely-positioned tooltip inside one is cut off
 * by the first ancestor with `overflow: hidden` (STATE.md §5j). `position:
 * fixed` takes the tooltip out of that flow entirely, and the coordinates come
 * from the trigger's own bounding box measured at the moment it opens.
 *
 * Measured on open rather than on every scroll frame: a tooltip that is open
 * while the page scrolls is a rare state, and tracking it would cost a listener
 * on every tooltip in a 400-row table.
 *
 * ── Tooltips are not a place to put information ──────────────────────────
 * Touch devices have no hover, so anything a tooltip says is invisible to a
 * phone user. Nothing here may carry meaning the reader needs — it is for
 * naming an icon-only control or expanding an abbreviation, never for the
 * explanation of a field. When the reader genuinely needs the text, put it on
 * the page as help text.
 *
 * For an icon-only button, prefer `Icon`'s own `label` for the accessible name
 * and use this for the sighted-user hint; the tooltip is `aria-describedby`, an
 * addition to the name rather than a replacement for it.
 */

export type TooltipSide = 'top' | 'bottom';

export interface TooltipProps {
  /** The tooltip text. Keep it to a few words. */
  content: string;
  side?: TooltipSide;
  /** The trigger. Must be focusable, or keyboard users never see this. */
  children: ReactNode;
  className?: string;
}

/** Gap between the trigger and the tooltip, in pixels. */
const OFFSET = 8;

export function Tooltip({ content, side = 'top', children, className }: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const open = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger === null) return;

    const box = trigger.getBoundingClientRect();

    setPosition({
      top: side === 'top' ? box.top - OFFSET : box.bottom + OFFSET,
      left: box.left + box.width / 2,
    });
  }, [side]);

  const close = useCallback(() => setPosition(null), []);

  return (
    <>
      <span
        ref={triggerRef}
        onPointerEnter={open}
        onPointerLeave={close}
        onFocusCapture={open}
        onBlurCapture={close}
        // Escape closes it, matching every other transient overlay here.
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
        aria-describedby={position === null ? undefined : id}
        className={cn('inline-flex', className)}
      >
        {children}
      </span>

      {position === null ? null : (
        <span
          role="tooltip"
          id={id}
          style={{
            top: position.top,
            left: position.left,
            // Centre horizontally on the trigger, and sit above or below it.
            transform: `translate(-50%, ${side === 'top' ? '-100%' : '0'})`,
          }}
          className={cn(
            'pointer-events-none fixed z-tooltip max-w-[16rem] rounded-control px-2 py-1',
            'text-2xs font-medium shadow-popover',
            // Inverted against the page: the ink colour as the surface, the
            // page colour as the lettering. Both come from the school's palette,
            // so this reads as deliberate on a dark theme as on a light one.
            'bg-ink text-surface',
            'animate-fade-in',
          )}
        >
          {content}
        </span>
      )}
    </>
  );
}
