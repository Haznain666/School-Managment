'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

/** Only allow same-site relative paths back into the panel. */
function safeRedirect(next: string | null): string {
  if (next === null) return '/super-admin';
  if (!next.startsWith('/super-admin')) return '/super-admin';
  // Reject protocol-relative URLs like `//evil.com`.
  if (next.startsWith('//')) return '/super-admin';
  return next;
}

/**
 * ── Why `next` is read here and not passed down from the page ────────────
 * Reading `searchParams` in the server component made this route
 * `force-dynamic`, and it was measured at ~1.0s of origin time on every single
 * request — for a page with no database access and a trivial tree. Reading the
 * parameter on the client instead lets the page be prerendered once at build
 * time and served from the CDN edge, which measured ~85ms.
 *
 * The redirect target was never trusted anyway: `safeRedirect` below is what
 * makes it safe, and it runs identically wherever the value came from.
 */
export function SuperAdminLoginForm() {
  const router = useRouter();
  const nextPath = useSearchParams().get('next');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setIsSubmitting(true);

      try {
        await superAdminFetch<{ email: string }>('/api/super-admin/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });

        router.replace(safeRedirect(nextPath));
        // The layout reads the session server-side, so force a re-render.
        router.refresh();
      } catch (caught) {
        setError(
          caught instanceof SuperAdminApiError
            ? caught.message
            : 'Sign-in failed. Please try again.',
        );
        setIsSubmitting(false);
      }
    },
    [email, password, nextPath, router],
  );

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      /*
        `method="post"` matters even though this form is never submitted
        natively in the happy path.

        Submitting before React has hydrated — pressing Enter while the route
        is still compiling, or any time hydration fails — makes the browser
        perform the form's *native* submit. A form with no method defaults to
        GET, and GET puts every named field in the query string. That is how
        `GET /super-admin/login?email=…&password=…` reached the server log,
        with the password in plain text in the URL, in browser history, and in
        any Referer header this page emits.

        With POST the same pre-hydration submit sends the fields in a request
        body to a page route that does not accept POST, so it fails visibly and
        harmlessly. Credentials never reach a URL either way.
      */
      method="post"
      className="space-y-4 rounded-card border border-line bg-surface-raised p-6 shadow-card"
      noValidate
    >
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
        disabled={isSubmitting}
      />

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
        disabled={isSubmitting}
      />

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      <Button type="submit" fullWidth isLoading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}
