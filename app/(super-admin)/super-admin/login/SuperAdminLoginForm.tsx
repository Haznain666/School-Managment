'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { superAdminFetch, SuperAdminApiError } from '@/lib/super-admin-client';

export interface SuperAdminLoginFormProps {
  /** Where to go after signing in, when redirected here from a deep link. */
  nextPath: string | null;
}

/** Only allow same-site relative paths back into the panel. */
function safeRedirect(next: string | null): string {
  if (next === null) return '/super-admin';
  if (!next.startsWith('/super-admin')) return '/super-admin';
  // Reject protocol-relative URLs like `//evil.com`.
  if (next.startsWith('//')) return '/super-admin';
  return next;
}

export function SuperAdminLoginForm({ nextPath }: SuperAdminLoginFormProps) {
  const router = useRouter();

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
      className="space-y-4 rounded-card border border-slate-200 bg-white p-6 shadow-card"
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
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Button type="submit" fullWidth isLoading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}
