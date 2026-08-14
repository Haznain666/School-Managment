'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

/**
 * A dialog, built on the native `<dialog>` element.
 *
 * ── Why native, and not a div with a high z-index ────────────────────────
 * STATE.md §5j records a dropdown that was invisible in production because
 * `Card`'s `overflow-hidden` clipped it. Any absolutely-positioned overlay
 * rendered inside the page's own DOM is one `overflow` or `transform` away from
 * that bug, and this product nests cards inside panels inside scrolling
 * regions. `<dialog>` opened with `showModal()` is promoted to the browser's
 * top layer, which sits above every stacking context on the page by definition
 * — so it cannot be clipped by an ancestor, and needs no portal.
 *
 * It also brings, for free and correctly, the things a hand-rolled modal gets
 * wrong: focus is moved into the dialog and restored on close, the rest of the
 * page becomes inert to screen readers, and Escape closes it.
 *
 * ── A note on when *not* to reach for this ───────────────────────────────
 * A modal is usually laziness. It stops the reader, hides the context they were
 * working in, and on a phone it is the whole screen. Before using one, check
 * whether the interaction fits inline (an expanding row), in place (edit the
 * field where it sits), or on its own route (anything with more than three
 * fields). This exists mainly for destructive confirmations, which genuinely
 * do need to interrupt.
 */

export interface ModalProps {
  open: boolean;
  /**
   * Called for every dismissal — the close button, Escape, and a click on the
   * backdrop. The caller owns `open`, so a modal cannot get out of sync with
   * the state that opened it.
   */
  onClose: () => void;
  title: string;
  /** One line under the title. Say what the consequence is, not what the button says. */
  description?: string;
  /** Right-aligned action row. Primary action last, matching platform convention. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /**
   * Blocks backdrop and Escape dismissal. For a modal whose work is genuinely
   * uninterruptible — mid-import, mid-payroll-run. Used sparingly: a dialog
   * that cannot be escaped is a trap when something goes wrong inside it.
   */
  dismissable?: boolean;
  children: ReactNode;
}

const SIZE_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  dismissable = true,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  /**
   * Drive the element imperatively from the `open` prop.
   *
   * The `open` *attribute* is deliberately not used: it renders a non-modal
   * dialog inline, without the top layer, the focus trap or the backdrop —
   * which is to say without any of the reasons to use `<dialog>` at all. Only
   * `showModal()` gives those.
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  /**
   * The browser fires `cancel` for Escape. Prevent the default close so that
   * dismissal always flows through `onClose` and the caller's state stays the
   * single source of truth — otherwise Escape closes the element while `open`
   * remains true, and the modal cannot be reopened.
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    const onCancel = (event: Event) => {
      event.preventDefault();
      if (dismissable) onClose();
    };

    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [dismissable, onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      /*
       * The backdrop is styled through `::backdrop` in the arbitrary variant
       * below rather than with a sibling div, so it is the browser's own
       * backdrop and inherits the top-layer behaviour.
       *
       * `m-auto` plus `max-h` keeps a tall dialog centred and scrollable rather
       * than running off the top of the viewport, which is the default
       * `<dialog>` failure on a short screen.
       */
      className={cn(
        'm-auto w-[calc(100vw-2rem)] rounded-card border border-line bg-surface-raised p-0 text-ink shadow-modal',
        'max-h-[calc(100dvh-4rem)] overflow-visible',
        'backdrop:bg-[rgb(2_6_23/0.55)] backdrop:backdrop-blur-[2px]',
        'open:animate-slide-up',
        SIZE_CLASSES[size],
      )}
      onClick={(event) => {
        // A click on the dialog element itself is a click on the backdrop —
        // the content is a child, so it stops here only when nothing else
        // caught it. Comparing targets is what distinguishes the two.
        if (dismissable && event.target === dialogRef.current) onClose();
      }}
    >
      <div className="flex max-h-[calc(100dvh-4rem)] flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-balance text-base font-semibold text-ink">
              {title}
            </h2>
            {description !== undefined ? (
              <p id={descriptionId} className="mt-1 text-pretty text-sm text-ink-muted">
                {description}
              </p>
            ) : null}
          </div>

          {dismissable ? (
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 -mt-1 shrink-0 rounded-control p-1.5 text-ink-muted transition-colors duration-fast hover:bg-surface-hover hover:text-ink"
            >
              <Icon as={X} size="sm" label="Close" />
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer !== undefined ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-sunken px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
