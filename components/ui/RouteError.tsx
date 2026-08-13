'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * The body of every route-level `error.tsx`.
 *
 * ── What it deliberately does not show ───────────────────────────────────
 * Not the error message. Next.js replaces server error messages with a generic
 * string in production precisely because they leak — a Postgres error can carry
 * a column name, a constraint name, or a fragment of a query. This is a
 * multi-tenant product, so an error surface is the last place to improvise.
 *
 * What it shows instead is a `digest`: the hash Next.js writes to the server
 * log beside the real stack. That is the only piece worth putting on screen,
 * because it is the one thing that lets an operator's "it broke" become a
 * specific line in the log. Without it, a support conversation starts from
 * nothing.
 *
 * ── Retry is `reset()`, not a reload ─────────────────────────────────────
 * `reset()` re-renders the failed segment in place, keeping the shell, the
 * scroll position and any client state outside it. A full reload throws all of
 * that away to fix what is usually a transient database hiccup — and against
 * Supabase from this market, a transient hiccup is the likely cause.
 */

export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** What failed, in the reader's terms: "the fee challans", "this student". */
  subject?: string;
}

export function RouteError({ error, reset, subject = 'this page' }: RouteErrorProps) {
  useEffect(() => {
    // The server already logged it; this is the browser-side half, so a
    // client-thrown error is not lost entirely.
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      tone="error"
      title={`Could not load ${subject}`}
      description={
        error.digest === undefined
          ? 'Something went wrong on our side. Trying again usually works — the data itself is fine.'
          : `Something went wrong on our side. Trying again usually works. If it keeps happening, quote reference ${error.digest}.`
      }
      action={
        <Button icon={RefreshCw} onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
