'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

export interface QueryNoticeProps {
  /** Query parameter that triggers the notice, e.g. `reset`. */
  param: string;
  message: string;
}

/**
 * A dismissible banner shown when a query parameter is present.
 *
 * This is the "toast" for the two flows that end with a redirect and something
 * worth saying — a completed password reset landing on sign-in, and a newly
 * accepted invitation landing in a portal. There is no toast system in this
 * application, and adding one for two messages that must survive a full
 * navigation would be the wrong shape anyway: a toast lives in memory and the
 * message has to outlive the page that caused it.
 *
 * Deliberately not a security boundary. Anyone can append `?reset=1` and see
 * the banner; all it costs them is a sentence.
 */
export function QueryNotice({ param, message }: QueryNoticeProps) {
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || searchParams.get(param) === null) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
    >
      <p>{message}</p>

      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 text-emerald-600 hover:text-emerald-900"
        onClick={() => {
          setDismissed(true);
        }}
      >
        ×
      </button>
    </div>
  );
}
