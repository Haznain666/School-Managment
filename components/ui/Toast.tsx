'use client';

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { Icon, type LucideIcon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

/**
 * Transient confirmations — "Voucher issued", "3 reminders queued".
 *
 * ── What a toast may and may not carry ───────────────────────────────────
 * A toast disappears, so nothing that the reader might need to act on or
 * remember belongs in one. In particular: **failures that lose work do not go
 * here.** If a payroll run or a marks submission fails, the error belongs on
 * the page beside the thing that failed, where it persists and can be read
 * twice. A `danger` toast is for a failure the reader can simply retry — a
 * refresh that did not land, a copy-to-clipboard that was blocked.
 *
 * This distinction is why `danger` toasts do not auto-dismiss below.
 *
 * ── The live region ──────────────────────────────────────────────────────
 * One region, declared once by the provider and always present in the DOM.
 * A live region that is inserted at the same moment as its content is
 * frequently not announced at all — the screen reader has to be observing the
 * region before the text arrives. This is the single most common way toast
 * implementations are silently inaccessible.
 *
 * `polite` for success and info, `assertive` for warnings and failures, so a
 * confirmation does not interrupt what the reader is in the middle of hearing
 * but a problem does.
 */

export type ToastTone = 'success' | 'danger' | 'warning' | 'info';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  /** Optional second line. One sentence. */
  description?: string;
}

export type ToastInput = Omit<Toast, 'id'>;

interface ToastContextValue {
  toast: (input: ToastInput) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Raise a toast from anywhere below `ToastProvider`.
 *
 * Throws rather than no-oping when the provider is missing: a silently
 * swallowed confirmation is a bug that surfaces as "the save button does
 * nothing", days later and far from its cause.
 */
export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (value === null) {
    throw new Error('useToast must be used inside a <ToastProvider>.');
  }
  return value;
}

/** How long a self-dismissing toast stays, in milliseconds. */
const DURATION = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    setToasts((current) => {
      const next = [...current, { ...input, id }];
      // Cap the stack. Beyond three, the oldest is unread anyway and the column
      // starts covering the content it is reporting on.
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/*
        Both regions always mounted, so a screen reader is already observing
        them when a toast arrives. Empty until then.
      */}
      <ToastViewport
        toasts={toasts.filter((entry) => entry.tone === 'success' || entry.tone === 'info')}
        politeness="polite"
        onDismiss={dismiss}
      />
      <ToastViewport
        toasts={toasts.filter((entry) => entry.tone === 'danger' || entry.tone === 'warning')}
        politeness="assertive"
        onDismiss={dismiss}
      />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  politeness,
  onDismiss,
}: {
  toasts: readonly Toast[];
  politeness: 'polite' | 'assertive';
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-toast flex flex-col items-center gap-2 p-4',
        // Bottom-centre on a phone (near the thumb, clear of the top bar),
        // bottom-right on desktop where it does not cover the content column.
        'sm:inset-x-auto sm:bottom-4 sm:right-4 sm:items-end sm:p-0',
      )}
    >
      {toasts.map((entry) => (
        <ToastCard key={entry.id} toast={entry} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

const TONE_GLYPHS: Record<ToastTone, LucideIcon> = {
  success: CheckCircle2,
  danger: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const TONE_CLASSES: Record<ToastTone, string> = {
  success: 'text-status-success-ink',
  danger: 'text-status-danger-ink',
  warning: 'text-status-warning-ink',
  info: 'text-status-info-ink',
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  /*
   * Failures do not time out. Everything else does.
   *
   * A reader who looked away for six seconds and came back to no message has
   * no way to find out what went wrong; a success they missed costs nothing.
   */
  const selfDismissing = toast.tone === 'success' || toast.tone === 'info';

  useEffect(() => {
    if (!selfDismissing) return;
    const timer = setTimeout(() => onDismiss(toast.id), DURATION);
    return () => clearTimeout(timer);
  }, [selfDismissing, toast.id, onDismiss]);

  return (
    <div
      className={cn(
        // `pointer-events-auto` re-enables interaction on the card itself; the
        // viewport is transparent to clicks so it does not block the page it
        // floats over.
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-line',
        'bg-surface-raised p-3.5 shadow-popover',
        'animate-slide-up',
      )}
    >
      <Icon as={TONE_GLYPHS[toast.tone]} size="md" className={cn('mt-0.5', TONE_CLASSES[toast.tone])} />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{toast.title}</p>
        {toast.description !== undefined ? (
          <p className="mt-0.5 text-pretty text-xs text-ink-muted">{toast.description}</p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-mr-1 -mt-1 shrink-0 rounded-control p-1 text-ink-muted transition-colors duration-fast hover:bg-surface-hover hover:text-ink"
      >
        <Icon as={X} size="xs" label="Dismiss" />
      </button>
    </div>
  );
}
