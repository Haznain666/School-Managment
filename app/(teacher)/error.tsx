'use client';

import { RouteError } from '@/components/ui/RouteError';

/**
 * Error boundary for the teacher portal.
 *
 * Must be a client component — that is how Next.js error boundaries work — and
 * must not render the error message. See `components/ui/RouteError.tsx` for why
 * only the digest is shown.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} subject="this page" />;
}
